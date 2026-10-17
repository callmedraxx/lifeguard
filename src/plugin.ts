import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { evmOutputSchema } from "./paybox.js";
import { findStuckFunds, proposeRefuel } from "./rescue.js";
import { allowUndo, checkPayment, pendingPayments, releasePayment, sendWithUndo, summarize, undoPayment } from "./undo.js";

const PROTOCOL_VERSION = "2026-07-28";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const amount = z.string().regex(/^\d+(\.\d+)?$/).describe('Human amount, e.g. "4" or "12.50" (not raw on-chain units)');
const token = z.string().min(1).max(64).default("USDC").describe('"USDC" or a Base token contract address');
const from = address.describe("The paying PayBox wallet's public address on Base");
const paymentId = z.string().regex(/^\d+$/).describe("payment_id from pending_payments");
const checkShape = z.object({ level: z.enum(["ok", "warn", "block"]), message: z.string() }).strict();
const chainRow = z.object({
  chain: z.string(), name: z.string(), chain_id: z.number(), native: z.string(), native_balance: z.string(), native_needed: z.string(),
  tokens: z.array(z.object({ symbol: z.string(), amount: z.string() }).strict()), usd: z.number(),
}).strict();

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const proposes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

// Plugin errors go back to the agent as readable text, never as a proposal.
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] });
const safe = <A, R>(fn: (a: A) => Promise<R>) => async (a: A) => { try { return await fn(a); } catch (e) { return fail(e); } };

function createServer() {
  const server = new McpServer(
    { name: "lifeguard", version: "0.1.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  // ---- Undo: payments with a cancel window ----

  server.registerTool("check_payment", {
    title: "Check a payment before sending",
    description: "Catches the mistakes that make crypto payments unrecoverable before anything is signed: a decimals or amount error (pass intent_usd, what the user meant to pay), sending to the token contract or a burn address, a never-used or contract recipient, more than the balance, and no gas. Base only. Read-only.",
    inputSchema: z.object({ from, to: address.describe("Recipient address"), token, amount, intent_usd: z.number().positive().optional().describe("What the user meant to pay in USD, for the decimals check") }).strict(),
    outputSchema: z.object({
      verdict: z.enum(["ok", "warn", "block"]), token: z.string(), token_address: z.string(), amount: z.string(),
      value_usd: z.number().nullable(), balance: z.string(), recipient: z.string(), checks: z.array(checkShape),
    }).strict(),
    annotations: readOnly,
  }, safe(async a => {
    const r = await checkPayment(a);
    return { content: [{ type: "text" as const, text: summarize(r) }], structuredContent: r };
  }));

  server.registerTool("allow_undo", {
    title: "Allow undoable payments (one-time approval)",
    description: "Proposes the token approval that lets the undo contract (Sablier Lockup on Base) hold exactly this amount. Needed once before send_with_undo when it reports too low an allowance.",
    inputSchema: z.object({ from, token, amount }).strict(),
    outputSchema: evmOutputSchema,
    annotations: proposes,
  }, safe(allowUndo));

  server.registerTool("send_with_undo", {
    title: "Send a payment you can undo",
    description: "Pays someone on Base with an undo window. The money is locked for undo_minutes; until then undo_payment returns all of it to the payer, after that it unlocks for the recipient. Runs check_payment first and refuses blocked payments. Use it for any payment you might regret: new recipients, large amounts, agent-initiated payments. For freelance work, set an arbiter both sides agree on so neither side can act alone.",
    inputSchema: z.object({
      from, to: address.describe("Recipient address"), token, amount,
      undo_minutes: z.number().int().min(5).max(10080).default(60).describe("How long the payment can be undone (5 minutes to 7 days)"),
      intent_usd: z.number().positive().optional().describe("What the user meant to pay in USD, for the decimals check"),
      arbiter: address.optional().describe("Optional neutral party both sides agreed on (a person, multisig or arbitration service). If set, only the arbiter can undo, so the payer cannot pull back a payment for finished work alone."),
    }).strict(),
    outputSchema: evmOutputSchema,
    annotations: proposes,
  }, safe(sendWithUndo));

  server.registerTool("pending_payments", {
    title: "List undoable payments",
    description: "Lists undoable payments this wallet paid, receives or arbitrates, newest first, with status: undoable (and minutes left), ready_to_release, delivered or undone. New payments can take a minute to appear.",
    inputSchema: z.object({ wallet: address.describe("The payer's wallet address") }).strict(),
    outputSchema: z.object({
      wallet: z.string(),
      payments: z.array(z.object({
        payment_id: z.string(), role: z.enum(["payer", "recipient", "arbiter"]), payer: z.string(), recipient: z.string(), arbiter: z.string().nullable(),
        token: z.string(), amount: z.string(),
        status: z.enum(["undoable", "ready_to_release", "delivered", "undone"]),
        sent_at: z.string(), unlocks_at: z.string(), minutes_left_to_undo: z.number(),
      }).strict()),
    }).strict(),
    annotations: readOnly,
  }, safe(async a => {
    const r = await pendingPayments(a);
    const text = r.payments.length
      ? r.payments.map(p => `#${p.payment_id} (${p.role}) ${p.amount} ${p.token} → ${p.recipient}: ${p.status}${p.status === "undoable" ? ` (${p.minutes_left_to_undo} min left)` : ""}`).join("\n")
      : "No undoable payments found for this wallet.";
    return { content: [{ type: "text" as const, text }], structuredContent: r };
  }));

  server.registerTool("undo_payment", {
    title: "Undo a payment",
    description: "Cancels a payment that is still inside its undo window and returns all of it to the payer. Only the payer can undo.",
    inputSchema: z.object({ from, payment_id: paymentId }).strict(),
    outputSchema: evmOutputSchema,
    annotations: proposes,
  }, safe(undoPayment));

  server.registerTool("release_payment", {
    title: "Deliver a payment after its undo window",
    description: "Once the undo window has passed, sends the money to the recipient's wallet. The payer, the recipient or anyone else may trigger it.",
    inputSchema: z.object({ payment_id: paymentId }).strict(),
    outputSchema: evmOutputSchema,
    annotations: proposes,
  }, safe(releasePayment));

  // ---- Rescue: money stuck where there is no gas to move it ----

  server.registerTool("find_stuck_funds", {
    title: "Find money stuck without gas",
    description: "Scans a wallet's USDC and USDT on Ethereum, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Linea and Scroll, and reports where tokens are stuck because the wallet lacks the native coin to pay gas. Read-only.",
    inputSchema: z.object({ wallet: address, min_usd: z.number().min(0).default(1).describe("Ignore balances below this") }).strict(),
    outputSchema: z.object({
      wallet: z.string(), total_stuck_usd: z.number(), stuck: z.array(chainRow), movable: z.array(chainRow),
      unreachable: z.array(z.object({ chain: z.string(), error: z.string() }).strict()), chains_checked: z.array(z.string()),
    }).strict(),
    annotations: readOnly,
  }, safe(async a => {
    const r = await findStuckFunds(a);
    const text = r.stuck.length
      ? `$${r.total_stuck_usd} is stuck without gas:\n` + r.stuck.map(s => `- ${s.name}: ${s.tokens.map(t => `${t.amount} ${t.symbol}`).join(", ")} (has ${Number(s.native_balance).toFixed(6)} ${s.native}, needs ~${Number(s.native_needed).toFixed(6)})`).join("\n") +
        `\nUse propose_refuel with chains [${r.stuck.map(s => `"${s.chain}"`).join(", ")}] to fix all of them in one transaction.`
      : "Nothing is stuck: every chain with USDC/USDT also has gas.";
    return { content: [{ type: "text" as const, text }], structuredContent: r };
  }));

  server.registerTool("propose_refuel", {
    title: "Refuel gas on several chains in one transaction",
    description: "Proposes ONE Base transaction (ETH via Gas.zip) that delivers gas to the wallet on every listed chain, so stuck tokens can move again. Chains Gas.zip cannot serve right now are skipped and named.",
    inputSchema: z.object({
      wallet: address.describe("Wallet that pays on Base and receives the gas on the other chains"),
      chains: z.array(z.string()).min(1).max(8).describe('Chain keys from find_stuck_funds, e.g. ["arbitrum","polygon"]'),
      usd_per_chain: z.number().min(0.25).max(10).default(1).describe("Gas to deliver per chain, in USD"),
    }).strict(),
    outputSchema: evmOutputSchema,
    annotations: proposes,
  }, safe(proposeRefuel));

  return server;
}

serveStdio(createServer, { legacy: "reject" });
