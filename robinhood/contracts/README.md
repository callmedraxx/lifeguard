# LifeguardEscrow

The undo contract behind Lifeguard on Robinhood Chain. A payment waits in the contract for an undo window
(5 minutes to 30 days). Until the window ends the payer (or only the arbiter, if one was named) can undo it
and get all of it back; the recipient can refuse it; after the window anyone can release it to the recipient.
No owner, no fees, no upgrades.

```sh
forge install foundry-rs/forge-std --no-git   # once
forge test
forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.chain.robinhood.com/rpc --private-key $KEY --broadcast
```

Robinhood Chain testnet: chain id 46630, explorer https://explorer.testnet.chain.robinhood.com,
faucet https://faucet.testnet.chain.robinhood.com.
