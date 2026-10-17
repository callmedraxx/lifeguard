# Lifeguard

**An undo button for crypto payments, built for AI agents.** A [PayBox](https://paybox.sh) plugin.

Crypto payments can't be taken back. A wrong address, a wrong amount or a scam means the money is gone, and AI agents now send payments for us. Lifeguard gives every agent payment an undo window: the money is locked on-chain for as long as you choose, and until then you can cancel it and get all of it back.

Built for the PayBox Hackathon (Chapter 1) by [@callmedraxxx](https://x.com/callmedraxxx).

## Demo

Real money on Base mainnet, with Claude as the agent and PayBox signing:

1. Claude pays a designer $1 with a 60-minute undo window. That's payment #1362, send tx [`0xd108a1c7…c8f7`](https://basescan.org/tx/0xd108a1c72ba1b1fc1dc8a087bc41f25861d26f7ddba3fea78fa95e35fb67c8f7).
2. 27 minutes later: "the designer blocked me, undo the payment." Lifeguard shows 28 minutes left, and one approval cancels it. Undo tx [`0xe106ea7c…8657`](https://basescan.org/tx/0xe106ea7c0bb36603642ba060a55113baa585062af3d8756ae2efda6c7bef8657).
3. The full $1 is back in the wallet. Only gas was spent, under one cent.

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `check_payment` | read-only | Catches unrecoverable mistakes before signing: amount/decimals errors, paying a token contract or burn address, paying yourself, a brand-new recipient, low balance or gas. |
| `allow_undo` | proposal | Approves the undo contract (Sablier Lockup on Base) to hold exactly this amount. |
| `send_with_undo` | proposal | Pays with an undo window of 5 minutes to 7 days. Optional `arbiter`: only that neutral party can undo. |
| `pending_payments` | read-only | Lists payments this wallet paid, receives or arbitrates, with status and minutes left. |
| `undo_payment` | proposal | Cancels a payment inside its window and returns all of it to the payer. |
| `release_payment` | proposal | After the window, sends the money to the recipient. Anyone can trigger it. |
| `find_stuck_funds` | read-only | Finds USDC/USDT stuck for lack of gas on Ethereum, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Linea and Scroll. |
| `propose_refuel` | proposal | One Base transaction (via Gas.zip) that delivers gas to every chain with stuck funds. |

The agent never signs anything itself. Every proposal is approved by the user in PayBox.

## How it works

- Payments are Sablier Lockup linear streams on Base with a cliff at the end of the undo window. Until then the stream is cancelable and an undo returns the full amount. Without an arbiter it goes back to the payer; in arbiter mode only the arbiter can undo, and the refund goes to the arbiter. After it, the money unlocks for the recipient.
- Reads go through Multicall3 with RPC fallback (mainnet.base.org → base.drpc.org → base-rpc.publicnode.com). Pending payments come from the Sablier Envio indexer.

## Roadmap

Undo is step one. The goal is a **trust layer for agent payments**:

- **Signed agreements.** Client and freelancer sign the same scope, amount, deadline and arbiter, and the payment locks against that contract.
- **Freelancer verification page.** One link proves the money is really locked for them on-chain.
- **Auto gas refuel.** Agents top up gas before paying, so payments never fail on an empty chain.
- **Arbiter-enforced disputes.** Undo or early release only as the signed contract allows.
- **AI arbiter.** Reads the contract and the evidence, and proposes a ruling.

## Build

Requires Node 24 and pnpm 11.

```sh
pnpm install
pnpm typecheck
pnpm build        # dist/plugin.mjs
pnpm conformance  # PayBox plugin checks
```

## Licence

MIT
