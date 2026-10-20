# Lifeguard on Robinhood Chain

**An undo button for payments on Robinhood Chain.** Send ETH or stock tokens (TSLA, AMZN, PLTR, NFLX, AMD or any
token) with an undo window. Sent it to the wrong address, the token's own contract, or just changed your mind? Undo it
before the window ends and get all of it back. The recipient can refuse a payment they weren't expecting, and an
optional arbiter can settle disputes for freelance work.

- **App:** https://lifeguard-robinhood.vercel.app (testnet)
- **Contract:** [`0xc13B429326A1ABD34721824e6EFd8Cb8b191A6a7`](https://explorer.testnet.chain.robinhood.com/address/0xc13B429326A1ABD34721824e6EFd8Cb8b191A6a7)
  on Robinhood Chain testnet (chain id 46630), source verified. No owner, no fees, no upgrades.

## First live test (testnet)
1. Sent 1 TSLA with a 10-minute undo window: [`0xa5f58242…1b57`](https://explorer.testnet.chain.robinhood.com/tx/0xa5f5824296330b175c794a1c0928232c4c8cc97867a1a1e2a01cf2c273901b57)
2. Undid it: [`0x948e241a…6a4c`](https://explorer.testnet.chain.robinhood.com/tx/0x948e241aa36e1c8edaa53dd5d19fa00cc91e6f069dd732dbfb6818fdba136a4c).
   The full 1 TSLA came back; the contract holds nothing.

## What the app checks before you sign
Read live from the chain: the recipient is the token's own contract (the classic lost-funds mistake), any token
contract, a burn address, your own address, or the Lifeguard contract itself (all blocked); a smart contract or a
never-used address (warned); more than your balance (blocked).

## Layout
- `contracts/`: `LifeguardEscrow.sol`, 22 Foundry tests (`forge test`), deploy script. See `contracts/README.md`.
- `app/index.html`: the whole app, one static page (viem). `?escrow=0x…` points it at another deployment.
