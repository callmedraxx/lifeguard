import { erc20Abi, formatUnits, getAddress, isAddress } from "viem";
import { CHAINS, GASZIP_API, STABLES, client } from "./chains.js";
import { proposeEvm } from "./paybox.js";

// Gas.zip's deposit contract on Base, as returned by its quote API. Anything else is refused.
const GASZIP_DEPOSIT = "0x2a37d63eadfe4b4682a3c28c1c2cd4f109cc2762";
// A token transfer costs about 65k gas on these chains; 120k with a 1.5x price buffer leaves room for a swap or bridge too.
const MOVE_GAS = 120_000n;

// Gas.zip answers 500 when any chain in a quote fails, but its body still says which chains worked.
async function gasZip(path: string): Promise<any> {
  const res = await fetch(`${GASZIP_API}${path}`, { signal: AbortSignal.timeout(4000) });
  try { return await res.json(); } catch { throw new Error(`Gas.zip answered ${res.status}`); }
}

export async function findStuckFunds(input: { wallet: string; min_usd: number }) {
  if (!isAddress(input.wallet)) throw new Error("wallet must be a 0x address.");
  const wallet = getAddress(input.wallet);
  const results = await Promise.all(CHAINS.map(async ch => {
    const c = client(ch.rpc);
    try {
      const [native, gasPrice, tokens] = await Promise.all([
        c.getBalance({ address: wallet }),
        c.getGasPrice(),
        Promise.all(ch.tokens.map(async t => {
          const [bal, dec] = await Promise.all([
            c.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
            c.readContract({ address: t.address, abi: erc20Abi, functionName: "decimals" }),
          ]);
          return { symbol: t.symbol, amount: Number(formatUnits(bal, dec)) };
        })),
      ]);
      const needed = (gasPrice * MOVE_GAS * 3n) / 2n;
      const held = tokens.filter(t => t.amount > 0);
      const usd = held.filter(t => STABLES.has(t.symbol)).reduce((s, t) => s + t.amount, 0);
      return {
        chain: ch.key, name: ch.name, chain_id: ch.id, native: ch.native,
        native_balance: formatUnits(native, 18), native_needed: formatUnits(needed, 18),
        has_gas: native >= needed, tokens: held.map(t => ({ symbol: t.symbol, amount: t.amount.toFixed(2) })), usd: Math.round(usd * 100) / 100,
      };
    } catch (e: any) {
      return { chain: ch.key, name: ch.name, error: String(e?.shortMessage ?? e?.message ?? e).slice(0, 120) };
    }
  }));
  const ok = results.filter((r): r is Extract<typeof r, { usd: number }> => "usd" in r);
  const stuck = ok.filter(r => !r.has_gas && r.usd >= input.min_usd);
  return {
    wallet,
    total_stuck_usd: Math.round(stuck.reduce((s, r) => s + r.usd, 0) * 100) / 100,
    stuck: stuck.map(({ has_gas, ...r }) => r),
    movable: ok.filter(r => r.has_gas && r.usd > 0).map(({ has_gas, ...r }) => r),
    unreachable: results.filter(r => "error" in r).map(r => ({ chain: r.chain, error: (r as any).error })),
    chains_checked: CHAINS.map(c => c.key),
  };
}

export async function proposeRefuel(input: { wallet: string; chains: string[]; usd_per_chain: number }) {
  if (!isAddress(input.wallet)) throw new Error("wallet must be a 0x address.");
  const wallet = getAddress(input.wallet);
  const picked = input.chains.map(k => {
    const ch = CHAINS.find(c => c.key === k.toLowerCase() || String(c.id) === k);
    if (!ch) throw new Error(`Unknown chain "${k}". Use one of: ${CHAINS.map(c => c.key).join(", ")}.`);
    return ch;
  });
  const ids = [...new Set(picked.map(c => c.id))];
  // Price probe: what 0.001 ETH deposited on Base buys on each chain, in USD.
  const probe = await gasZip(`/v2/quotes/8453/1000000000000000/${ids.join(",")}?from=${wallet}&to=${wallet}`);
  if (probe.error && !probe.quotes) throw new Error(`Gas.zip: ${probe.error}`);
  const usable = (probe.quotes ?? []).filter((q: any) => !q.error && q.usd > 0);
  const skipped = (probe.quotes ?? []).filter((q: any) => q.error).map((q: any) => `${CHAINS.find(c => c.id === q.chain)?.name ?? q.chain}: ${q.error.replace(/^Quote: /, "")}`);
  if (!usable.length) throw new Error(`Gas.zip cannot refuel any of those chains right now (${skipped.join("; ")}).`);
  // A failed chain still takes its share of a probe's deposit, so price again with only the usable chains.
  const priced = usable.length === ids.length ? usable
    : ((await gasZip(`/v2/quotes/8453/1000000000000000/${usable.map((q: any) => q.chain).join(",")}?from=${wallet}&to=${wallet}`)).quotes ?? []).filter((q: any) => !q.error && q.usd > 0);
  if (priced.length !== usable.length) throw new Error("Gas.zip prices changed mid-quote; try again.");
  const usdPerMilliEth = priced.reduce((s: number, q: any) => s + q.usd, 0);
  const wei = BigInt(Math.ceil((input.usd_per_chain * usable.length / usdPerMilliEth) * 1e15));
  const quote = await gasZip(`/v2/quotes/8453/${wei}/${usable.map((q: any) => q.chain).join(",")}?from=${wallet}&to=${wallet}`);
  const tx = quote.contractDepositTxn;
  if (!tx || quote.error) throw new Error(`Gas.zip did not return a deposit: ${quote.error ?? "no transaction"}`);
  if (String(tx.to).toLowerCase() !== GASZIP_DEPOSIT) throw new Error(`Gas.zip returned an unexpected deposit address (${tx.to}); refusing to propose it.`);
  const r = proposeEvm({ chain: "eip155:8453", to: getAddress(tx.to), value: BigInt(tx.value).toString(), data: tx.data });
  const lines = quote.quotes.map((q: any) => {
    const ch = CHAINS.find(c => c.id === q.chain);
    return `- ${ch?.name ?? q.chain}: about ${formatUnits(BigInt(q.expected), q.decimals)} ${ch?.native ?? ""} (~$${q.usd.toFixed(2)})`;
  });
  r.content = [{ type: "text", text:
    `One Base transaction of ${formatUnits(wei, 18)} ETH tops up gas for ${wallet} on ${usable.length} chain(s) through Gas.zip:\n${lines.join("\n")}` +
    (skipped.length ? `\nSkipped: ${skipped.join("; ")}` : "") + `\nGas usually arrives within a minute; then the stuck tokens can be moved.` }];
  return r;
}
