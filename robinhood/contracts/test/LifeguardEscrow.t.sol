// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LifeguardEscrow} from "../src/LifeguardEscrow.sol";

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public feeBps;      // fee-on-transfer, burned
    bool public returnsNothing; // USDT-style

    function setFee(uint256 bps) external { feeBps = bps; }
    function setReturnsNothing(bool v) external { returnsNothing = v; }
    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function approve(address s, uint256 amt) external returns (bool) { allowance[msg.sender][s] = amt; return true; }

    function _move(address from, address to, uint256 amt) internal {
        balanceOf[from] -= amt;
        balanceOf[to] += amt - amt * feeBps / 10_000;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        _move(msg.sender, to, amt);
        if (returnsNothing) assembly { return(0, 0) }
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        allowance[from][msg.sender] -= amt;
        _move(from, to, amt);
        if (returnsNothing) assembly { return(0, 0) }
        return true;
    }
}

/// Recipient that tries to re-enter on receiving ETH.
contract Reenterer {
    LifeguardEscrow public esc;
    uint256 public id;
    bool public tried;
    constructor(LifeguardEscrow e) { esc = e; }
    function setId(uint256 i) external { id = i; }
    receive() external payable {
        if (!tried) { tried = true; esc.release(id); }
    }
}

contract LifeguardEscrowTest is Test {
    LifeguardEscrow esc;
    MockToken usd;
    address payer = makeAddr("payer");
    address bob = makeAddr("bob");
    address judge = makeAddr("judge");
    address stranger = makeAddr("stranger");

    function setUp() public {
        esc = new LifeguardEscrow();
        usd = new MockToken();
        usd.mint(payer, 1_000e6);
        vm.prank(payer);
        usd.approve(address(esc), type(uint256).max);
        vm.deal(payer, 10 ether);
    }

    function _sendUsd(uint256 amt, uint64 window, address arbiter) internal returns (uint256) {
        vm.prank(payer);
        return esc.send(address(usd), bob, amt, window, arbiter);
    }

    // ---- happy paths ----

    function test_undo_returns_everything() public {
        uint256 id = _sendUsd(100e6, 1 hours, address(0));
        assertEq(usd.balanceOf(payer), 900e6);
        vm.warp(block.timestamp + 59 minutes);
        vm.prank(payer);
        esc.undo(id);
        assertEq(usd.balanceOf(payer), 1_000e6);
        assertEq(usd.balanceOf(bob), 0);
        assertEq(uint8(esc.payment(id).status), uint8(LifeguardEscrow.Status.Undone));
    }

    function test_release_after_window_by_anyone() public {
        uint256 id = _sendUsd(100e6, 1 hours, address(0));
        vm.warp(block.timestamp + 1 hours);
        vm.prank(stranger);
        esc.release(id);
        assertEq(usd.balanceOf(bob), 100e6);
    }

    function test_payer_can_release_early() public {
        uint256 id = _sendUsd(100e6, 1 hours, address(0));
        vm.prank(payer);
        esc.release(id);
        assertEq(usd.balanceOf(bob), 100e6);
    }

    function test_recipient_can_refuse() public {
        uint256 id = _sendUsd(100e6, 1 hours, address(0));
        vm.warp(block.timestamp + 2 hours); // even after the window, until released
        vm.prank(bob);
        esc.refuse(id);
        assertEq(usd.balanceOf(payer), 1_000e6);
    }

    function test_eth_payment_and_undo() public {
        vm.prank(payer);
        uint256 id = esc.send{value: 1 ether}(address(0), bob, 1 ether, 10 minutes, address(0));
        vm.prank(payer);
        esc.undo(id);
        assertEq(payer.balance, 10 ether);
        assertEq(address(esc).balance, 0);
    }

    function test_paymentsOf_lists_both_sides() public {
        _sendUsd(1e6, 1 hours, address(0));
        _sendUsd(2e6, 1 hours, address(0));
        (uint256[] memory sent,) = esc.paymentsOf(payer);
        (, uint256[] memory got) = esc.paymentsOf(bob);
        assertEq(sent.length, 2);
        assertEq(got.length, 2);
        assertEq(esc.count(), 2);
    }

    // ---- arbiter ----

    function test_arbiter_only_can_undo() public {
        uint256 id = _sendUsd(100e6, 1 hours, judge);
        vm.prank(payer);
        vm.expectRevert(LifeguardEscrow.NotAllowed.selector);
        esc.undo(id);
        vm.prank(judge);
        esc.undo(id);
        assertEq(usd.balanceOf(payer), 1_000e6);
    }

    function test_arbiter_can_release_early() public {
        uint256 id = _sendUsd(100e6, 1 hours, judge);
        vm.prank(judge);
        esc.release(id);
        assertEq(usd.balanceOf(bob), 100e6);
    }

    function test_arbiter_cannot_be_recipient() public {
        vm.prank(payer);
        vm.expectRevert(LifeguardEscrow.NotAllowed.selector);
        esc.send(address(usd), bob, 1e6, 1 hours, bob);
    }

    // ---- guards ----

    function test_blocks_bad_recipients() public {
        address[5] memory bad = [address(0), 0x000000000000000000000000000000000000dEaD, address(esc), payer, address(usd)];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(payer);
            vm.expectRevert(LifeguardEscrow.BadRecipient.selector);
            esc.send(address(usd), bad[i], 1e6, 1 hours, address(0));
        }
    }

    function test_window_bounds() public {
        vm.startPrank(payer);
        vm.expectRevert(LifeguardEscrow.BadWindow.selector);
        esc.send(address(usd), bob, 1e6, 4 minutes, address(0));
        vm.expectRevert(LifeguardEscrow.BadWindow.selector);
        esc.send(address(usd), bob, 1e6, 31 days, address(0));
        vm.stopPrank();
    }

    function test_amount_checks() public {
        vm.startPrank(payer);
        vm.expectRevert(LifeguardEscrow.BadAmount.selector);
        esc.send(address(usd), bob, 0, 1 hours, address(0));
        vm.expectRevert(LifeguardEscrow.BadAmount.selector);
        esc.send{value: 1 ether}(address(0), bob, 2 ether, 1 hours, address(0));
        vm.expectRevert(LifeguardEscrow.BadAmount.selector);
        esc.send{value: 1 ether}(address(usd), bob, 1e6, 1 hours, address(0));
        vm.stopPrank();
    }

    function test_no_undo_after_window() public {
        uint256 id = _sendUsd(100e6, 1 hours, address(0));
        vm.warp(block.timestamp + 1 hours);
        vm.prank(payer);
        vm.expectRevert(LifeguardEscrow.TooLate.selector);
        esc.undo(id);
    }

    function test_no_early_release_by_others() public {
        uint256 id = _sendUsd(100e6, 1 hours, address(0));
        vm.prank(bob);
        vm.expectRevert(LifeguardEscrow.TooEarly.selector);
        esc.release(id);
    }

    function test_stranger_cannot_undo_or_refuse() public {
        uint256 id = _sendUsd(100e6, 1 hours, address(0));
        vm.startPrank(stranger);
        vm.expectRevert(LifeguardEscrow.NotAllowed.selector);
        esc.undo(id);
        vm.expectRevert(LifeguardEscrow.NotAllowed.selector);
        esc.refuse(id);
        vm.stopPrank();
    }

    function test_settled_payment_cannot_move_again() public {
        uint256 id = _sendUsd(100e6, 1 hours, address(0));
        vm.prank(payer);
        esc.undo(id);
        vm.prank(payer);
        vm.expectRevert(LifeguardEscrow.NotPending.selector);
        esc.release(id);
        vm.prank(bob);
        vm.expectRevert(LifeguardEscrow.NotPending.selector);
        esc.refuse(id);
    }

    function test_unknown_id() public {
        vm.expectRevert(LifeguardEscrow.NotPending.selector);
        esc.release(7);
    }

    // ---- awkward tokens ----

    function test_fee_on_transfer_records_what_arrived() public {
        usd.setFee(100); // 1%
        uint256 id = _sendUsd(100e6, 1 hours, address(0));
        assertEq(esc.payment(id).amount, 99e6);
        vm.prank(payer);
        esc.undo(id); // pays out 99e6, never more than it holds
        assertEq(usd.balanceOf(address(esc)), 0);
    }

    function test_token_that_returns_nothing() public {
        usd.setReturnsNothing(true);
        uint256 id = _sendUsd(100e6, 1 hours, address(0));
        vm.warp(block.timestamp + 1 hours);
        esc.release(id);
        assertEq(usd.balanceOf(bob), 100e6);
    }

    function test_not_a_token() public {
        vm.prank(payer);
        vm.expectRevert(LifeguardEscrow.TransferFailed.selector);
        esc.send(makeAddr("eoa"), bob, 1e6, 1 hours, address(0));
    }

    // ---- reentrancy ----

    function test_reentry_is_blocked() public {
        Reenterer r = new Reenterer(esc);
        vm.prank(payer);
        uint256 id = esc.send{value: 1 ether}(address(0), address(r), 1 ether, 10 minutes, address(0));
        r.setId(id);
        vm.warp(block.timestamp + 10 minutes);
        // The re-entrant call reverts inside receive(), so the ETH transfer fails and the whole release reverts.
        vm.expectRevert(LifeguardEscrow.TransferFailed.selector);
        esc.release(id);
        assertEq(address(esc).balance, 1 ether);
    }

    // ---- fuzz: money is conserved ----

    function testFuzz_conservation(uint96 amt, uint64 window, bool undoIt) public {
        amt = uint96(bound(amt, 1, 1_000e6));
        window = uint64(bound(window, 5 minutes, 30 days));
        uint256 id = _sendUsd(amt, window, address(0));
        if (undoIt) {
            vm.prank(payer);
            esc.undo(id);
        } else {
            vm.warp(block.timestamp + window);
            esc.release(id);
        }
        assertEq(usd.balanceOf(payer) + usd.balanceOf(bob), 1_000e6);
        assertEq(usd.balanceOf(address(esc)), 0);
    }
}
