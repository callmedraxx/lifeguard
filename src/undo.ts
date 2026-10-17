import { encodeFunctionData, erc20Abi, formatUnits, getAddress, isAddress, parseUnits } from "viem";
import { BASE_TOKENS, SABLIER_INDEXER, SABLIER_LOCKUP, STABLES, UNDO_SHAPE, base, getJson } from "./chains.js";
import { proposeEvm } from "./paybox.js";
import { sablierAbi } from "./sablierAbi.js";

const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
const STATUS = ["pending", "streaming", "settled", "canceled", "depleted"] as const;

export type Check = { level: "ok" | "warn" | "block"; message: string };

export async function resolveToken(token: string) {
  const address = BASE_TOKENS[token.toUpperCase()] ?? (isAddress(token) ? getAddress(token) : null);
  if (!address) throw new Error(`Unknown token "${token}". Use USDC or a Base token contract address.`);
  const c = base();
  const [symbol, decimals] = await Promise.all([
    c.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    c.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { address, symbol, decimals };
}

/** The mistakes that make a payment unrecoverable, checked before anything is proposed. */
export async function checkPayment(input: { from: string; to: string; token: string; amount: string; intent_usd?: number }) {
  if (!isAddress(input.from)) throw new Error("from must be the paying wallet's 0x address.");
  if (!isAddress(input.to)) throw new Error("to must be a 0x address.");
  const from = getAddress(input.from), to = getAddress(input.to);
  const t = await resolveToken(input.token);
  const c = base();
  const [balance, ethBalance, code, nonce] = await Promise.all([
    c.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [from] }),
    c.getBalance({ address: from }),
    c.getCode({ address: to }),
    c.getTransactionCount({ address: to }),
  ]);
  const amount = parseUnits(input.amount, t.decimals);
  const stable = STABLES.has(t.symbol.toUpperCase());
  const valueUsd = stable ? Number(input.amount) : null;
  const checks: Check[] = [];
  const add = (level: Check["level"], message: string) => checks.push({ level, message });

  if (amount <= 0n) add("block", "The amount is zero.");
  if (BURN.has(to.toLowerCase())) add("block", "The recipient is a burn address: anything sent there is gone for good.");
  if (to.toLowerCase() === t.address.toLowerCase()) add("block", `The recipient is the ${t.symbol} token contract itself. Tokens sent there are lost; this is one of the most common mistakes.`);
  if (to.toLowerCase() === SABLIER_LOCKUP.toLowerCase()) add("block", "The recipient is the Sablier contract, not a person.");
  if (to === from) add("warn", "You are sending to your own wallet.");
  if (code && code !== "0x") add("warn", "The recipient is a smart contract, not a personal wallet. Make sure it is meant to receive tokens.");
  else if (nonce === 0) add("warn", "The recipient address has never sent a transaction. Double-check it was copied correctly.");
  if (amount > balance) add("block", `You only hold ${formatUnits(balance, t.decimals)} ${t.symbol}.`);
  else if (balance > 0n && amount * 2n >= balance) add("warn", `This is ${((Number(amount) / Number(balance)) * 100).toFixed(0)}% of your ${t.symbol}.`);
  if (ethBalance === 0n) add("warn", "The wallet has no ETH on Base to pay the network fee.");

  if (input.intent_usd !== undefined && valueUsd !== null && input.intent_usd > 0) {
    const ratio = valueUsd / input.intent_usd;
    if (ratio > 3 || ratio < 1 / 3) {
      const power = Math.round(Math.log10(ratio));
      add("block", Math.abs(power) >= 2
        ? `Possible decimals mistake: you meant about $${input.intent_usd}, but this sends $${valueUsd.toLocaleString("en-US")} (10^${power} times off).`
        : `You meant about $${input.intent_usd}, but this sends $${valueUsd.toLocaleString("en-US")}.`);
    }
  } else if (stable && /^\d+$/.test(input.amount) && amount >= 10n ** BigInt(t.decimals) * 10n ** BigInt(t.decimals)) {
    add("warn", `${input.amount} ${t.symbol} looks like a raw on-chain amount. Did you mean ${formatUnits(BigInt(input.amount), t.decimals)} ${t.symbol}?`);
  }

  const verdict = checks.some(x => x.level === "block") ? "block" : checks.some(x => x.level === "warn") ? "warn" : "ok";
  if (!checks.length) add("ok", "No problems found.");
  return {
    verdict, token: t.symbol, token_address: t.address, amount: input.amount, value_usd: valueUsd,
    balance: formatUnits(balance, t.decimals), recipient: to, checks,
  } as const;
}

export function summarize(r: Awaited<ReturnType<typeof checkPayment>>) {
  const head = { ok: "✅ Looks safe", warn: "⚠️ Check before sending", block: "⛔ Blocked" }[r.verdict];
  return `${head}: ${r.amount} ${r.token} to ${r.recipient}\n` + r.checks.map(c => `- ${c.level.toUpperCase()}: ${c.message}`).join("\n");
}

export async function allowUndo(input: { from: string; token: string; amount: string }) {
  const t = await resolveToken(input.token);
  const amount = parseUnits(input.amount, t.decimals);
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SABLIER_LOCKUP, amount] });
  const r = proposeEvm({ chain: "eip155:8453", to: t.address, value: "0", data });
  r.content = [{ type: "text", text: `Lets Lifeguard's undo contract (Sablier Lockup on Base) hold up to exactly ${input.amount} ${t.symbol} for undoable payments. Approve this once, then call send_with_undo.` }];
  return r;
}

export async function sendWithUndo(input: { from: string; to: string; token: string; amount: string; undo_minutes: number; intent_usd?: number; arbiter?: string }) {
  const check = await checkPayment(input);
  if (check.verdict === "block") throw new Error(summarize(check));
  if (input.arbiter !== undefined && !isAddress(input.arbiter)) throw new Error("arbiter must be a 0x address.");
  const arbiter = input.arbiter ? getAddress(input.arbiter) : null;
  if (arbiter && arbiter.toLowerCase() === input.from.toLowerCase()) throw new Error("The arbiter must be someone other than the payer; leave arbiter out for a payer-controlled undo.");
  if (arbiter && arbiter.toLowerCase() === input.to.toLowerCase()) throw new Error("The recipient cannot be the arbiter of their own payment.");
  const t = await resolveToken(input.token);
  const amount = parseUnits(input.amount, t.decimals);
  const allowance = await base().readContract({ address: t.address, abi: erc20Abi, functionName: "allowance", args: [getAddress(input.from), SABLIER_LOCKUP] });
  if (allowance < amount) {
    throw new Error(`Before an undoable payment, the undo contract must be allowed to hold ${input.amount} ${t.symbol} (currently ${formatUnits(allowance, t.decimals)}). Call allow_undo first, approve it, then call send_with_undo again.`);
  }
  const window = Math.round(input.undo_minutes * 60);
  // Nothing unlocks before the cliff; the whole amount unlocks at it. Until then the sender can cancel and get everything back.
  const data = encodeFunctionData({
    abi: sablierAbi, functionName: "createWithDurationsLL",
    args: [
      { sender: arbiter ?? getAddress(input.from), recipient: getAddress(input.to), depositAmount: amount, token: t.address, cancelable: true, transferable: false, shape: UNDO_SHAPE },
      { start: 0n, cliff: amount },
      1,
      { cliff: window, total: window + 1 },
    ],
  });
  const r = proposeEvm({ chain: "eip155:8453", to: SABLIER_LOCKUP, value: "0", data });
  const when = new Date(Date.now() + window * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  r.content = [{ type: "text", text:
    `${summarize(check)}\n\nUndoable payment: ${input.amount} ${t.symbol} to ${check.recipient}. ` +
    (arbiter
      ? `It stays locked until about ${when} (${input.undo_minutes} min). Only the agreed arbiter ${arbiter} can undo it in that time, and an undo returns the money to the arbiter, who settles with the payer. The payer cannot undo alone. After that it unlocks for the recipient (release_payment).`
      : `It stays locked until about ${when} (${input.undo_minutes} min). Until then undo_payment returns all of it to you; after that the recipient can receive it (release_payment).`) }];
  return r;
}

type IndexedStream = {
  tokenId: string; sender: string; funder: string; recipient: string; depositAmount: string; canceled: boolean; cliffTime: string | null;
  endTime: string; withdrawnAmount: string; timestamp: string; asset: { symbol: string; decimals: string } | null;
};

export async function pendingPayments(input: { wallet: string }) {
  if (!isAddress(input.wallet)) throw new Error("wallet must be a 0x address.");
  const query = `query($s:String!,$c:String!,$shape:String!){ LockupStream(where:{chainId:{_eq:"8453"},contract:{_eq:$c},shape:{_eq:$shape},_or:[{sender:{_eq:$s}},{funder:{_eq:$s}},{recipient:{_eq:$s}}]}, order_by:{timestamp:desc}, limit:25){ tokenId sender funder recipient depositAmount canceled cliffTime endTime withdrawnAmount timestamp asset { symbol decimals } } }`;
  const res = await getJson(SABLIER_INDEXER, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { s: input.wallet.toLowerCase(), c: SABLIER_LOCKUP.toLowerCase(), shape: UNDO_SHAPE } }),
  });
  if (res.errors) throw new Error(`Payment index error: ${res.errors[0]?.message}`);
  const now = Math.floor(Date.now() / 1000);
  const me = input.wallet.toLowerCase();
  const payments = (res.data.LockupStream as IndexedStream[]).map(s => {
    const arbiter = s.sender.toLowerCase() !== s.funder.toLowerCase() ? s.sender : null;
    const role = s.funder.toLowerCase() === me ? "payer" : s.recipient.toLowerCase() === me ? "recipient" : "arbiter";
    const decimals = Number(s.asset?.decimals ?? 6);
    const unlock = Number(s.cliffTime ?? s.endTime);
    const delivered = BigInt(s.withdrawnAmount) >= BigInt(s.depositAmount);
    const status = s.canceled ? "undone" : now < unlock ? "undoable" : delivered ? "delivered" : "ready_to_release";
    return {
      payment_id: s.tokenId, role, payer: s.funder, recipient: s.recipient, arbiter, token: s.asset?.symbol ?? "?",
      amount: formatUnits(BigInt(s.depositAmount), decimals), status,
      sent_at: new Date(Number(s.timestamp) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      unlocks_at: new Date(unlock * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      minutes_left_to_undo: status === "undoable" ? Math.ceil((unlock - now) / 60) : 0,
    };
  });
  return { wallet: getAddress(input.wallet), payments };
}

async function readStream(id: bigint) {
  const c = base();
  const read = (functionName: any, args: any[] = [id]) => c.readContract({ address: SABLIER_LOCKUP, abi: sablierAbi, functionName, args } as any) as Promise<any>;
  const [sender, recipient, token, deposited, status, cancelable, refundable, withdrawable, cliff] = await Promise.all([
    read("getSender"), read("getRecipient"), read("getUnderlyingToken"), read("getDepositedAmount"), read("statusOf"),
    read("isCancelable"), read("refundableAmountOf"), read("withdrawableAmountOf"), read("getCliffTime").catch(() => 0n),
  ]).catch((e: any) => {
    // A revert means the id does not exist; anything else is the node failing, so say that instead.
    if (/revert|ContractFunctionExecution/i.test(`${e?.name} ${e?.shortMessage ?? e?.message}`)) throw new Error(`Payment ${id} was not found on Base.`);
    throw new Error(`Base RPC did not answer (${e?.shortMessage ?? e?.message ?? e}); try again.`);
  });
  return { sender, recipient, token, deposited: deposited as bigint, status: STATUS[Number(status)] ?? "unknown", cancelable, refundable: refundable as bigint, withdrawable: withdrawable as bigint, cliff: Number(cliff) };
}

export async function undoPayment(input: { from: string; payment_id: string }) {
  const id = BigInt(input.payment_id);
  const s = await readStream(id);
  if (s.sender.toLowerCase() !== input.from.toLowerCase()) throw new Error(`Only ${s.sender} (the payer, or the arbiter both sides agreed on) can undo payment ${input.payment_id}.`);
  if (s.status === "canceled") throw new Error(`Payment ${input.payment_id} was already undone.`);
  if (!s.cancelable || s.refundable === 0n) throw new Error(`Too late: payment ${input.payment_id} has already unlocked for the recipient, so it can no longer be undone.`);
  const t = await resolveToken(s.token);
  const data = encodeFunctionData({ abi: sablierAbi, functionName: "cancel", args: [id] });
  const r = proposeEvm({ chain: "eip155:8453", to: SABLIER_LOCKUP, value: "0", data });
  r.content = [{ type: "text", text: `Undo payment ${input.payment_id}: ${formatUnits(s.refundable, t.decimals)} ${t.symbol} goes back to ${s.sender} (the payer, or the arbiter if one was set). The recipient (${s.recipient}) receives nothing.` }];
  return r;
}

export async function releasePayment(input: { payment_id: string }) {
  const id = BigInt(input.payment_id);
  const s = await readStream(id);
  if (s.status === "canceled") throw new Error(`Payment ${input.payment_id} was undone; there is nothing to release.`);
  if (s.withdrawable === 0n) {
    const now = Math.floor(Date.now() / 1000);
    throw new Error(s.cliff > now
      ? `Payment ${input.payment_id} is still in its undo window for about ${Math.ceil((s.cliff - now) / 60)} more minutes.`
      : `Payment ${input.payment_id} has already been delivered.`);
  }
  const fee = (await base().readContract({ address: SABLIER_LOCKUP, abi: sablierAbi, functionName: "calculateMinFeeWei", args: [id] })) as bigint;
  const t = await resolveToken(s.token);
  const data = encodeFunctionData({ abi: sablierAbi, functionName: "withdrawMax", args: [id, s.recipient] });
  const r = proposeEvm({ chain: "eip155:8453", to: SABLIER_LOCKUP, value: fee.toString(), data });
  r.content = [{ type: "text", text: `Deliver payment ${input.payment_id}: ${formatUnits(s.withdrawable, t.decimals)} ${t.symbol} to ${s.recipient}. Anyone may trigger this once the undo window has passed; the recipient can also collect it themselves.` }];
  return r;
}
