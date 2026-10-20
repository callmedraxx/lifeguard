// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {LifeguardEscrow} from "../src/LifeguardEscrow.sol";

/// forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.chain.robinhood.com/rpc --private-key $KEY --broadcast
contract Deploy is Script {
    function run() external returns (LifeguardEscrow esc) {
        vm.startBroadcast();
        esc = new LifeguardEscrow();
        vm.stopBroadcast();
        console.log("LifeguardEscrow", address(esc));
    }
}
