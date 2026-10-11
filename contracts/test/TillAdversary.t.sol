// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Till} from "../src/Till.sol";

/// A dollar that calls back into Till in the middle of a transfer, the way a hostile token or a
/// receiving contract with a hook would.
contract ReentrantDollar is ERC20, ERC20Permit {
    Till public till;
    uint256 public tabId;
    bytes4 public what;
    bool public armed;

    constructor() ERC20("Agora Dollar", "AUSD") ERC20Permit("Agora Dollar") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function disarm() external {
        armed = false;
    }

    function arm(Till t, uint256 id, bytes4 selector) external {
        till = t;
        tabId = id;
        what = selector;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from == address(till)) {
            armed = false; // one re-entry attempt per transfer out of the escrow
            (bool ok, bytes memory ret) = address(till).call(abi.encodeWithSelector(what, tabId));
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }
}

/// What an attacker tries after reading SECURITY.md. Each test name says what it proves.
contract TillAdversaryTest is Test {
    ReentrantDollar usd;
    ERC2771Forwarder fwd;
    Till till;

    uint256 clientKey = 0xC11E;
    address client;
    address freelancer = makeAddr("freelancer");

    uint64 constant RATE = 36e6;
    uint128 constant BUDGET = 100e6;

    function setUp() public {
        vm.warp(1_790_000_000);
        usd = new ReentrantDollar();
        fwd = new ERC2771Forwarder("Till");
        till = new Till(usd, address(fwd));
        client = vm.addr(clientKey);
        usd.mint(client, 1_000e6);
        vm.prank(client);
        usd.approve(address(till), type(uint256).max);
    }

    // ------------------------------------------------------------- reentrancy

    function test_settleCannotReenterSettle() public {
        uint256 id = _openAndWork();
        usd.arm(till, id, Till.settle.selector);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        till.settle(id);
        assertEq(usd.balanceOf(freelancer), 0, "the whole settle reverted, nothing moved");
    }

    function test_settleCannotReenterClose() public {
        uint256 id = _openAndWork();
        usd.arm(till, id, Till.close.selector);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        till.settle(id);
    }

    function test_closeCannotReenterSettleOrClose() public {
        uint256 id = _openAndWork();
        usd.arm(till, id, Till.settle.selector);
        vm.prank(client);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        till.close(id);

        usd.arm(till, id, Till.close.selector);
        vm.prank(client);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        till.close(id);

        // With the hook disarmed (a revert keeps it armed) the same close pays and refunds exactly once.
        usd.disarm();
        vm.prank(client);
        till.close(id);
        assertEq(usd.balanceOf(freelancer), RATE, "one hour of pay, paid once");
        assertEq(usd.balanceOf(client), 1_000e6 - RATE, "the rest came back once");
        assertEq(usd.balanceOf(address(till)), 0, "escrow empty");
    }

    function test_settleManyCannotReenter() public {
        uint256 id = _openAndWork();
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        usd.arm(till, id, Till.settle.selector);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        till.settleMany(ids);
    }

    // ------------------------------------------------------------- invites

    function test_inviteSignatureIsBoundToTabContractAndChain() public {
        (address inviteAddr, uint256 inviteKey) = makeAddrAndKey("invite");
        vm.startPrank(client);
        uint256 a = till.open(address(0), inviteAddr, RATE, BUDGET, "tab A");
        uint256 b = till.open(address(0), inviteAddr, RATE, BUDGET, "tab B"); // same invite key reused
        vm.stopPrank();

        bytes memory sigA = _inviteSig(inviteKey, address(till), a, freelancer);

        // The signature for tab A does nothing on tab B, even with the same invite key and claimer.
        vm.prank(freelancer);
        vm.expectRevert(Till.BadInvite.selector);
        till.claim(b, sigA);

        // Another Till deployment with the same tab id and invite key rejects it too.
        Till other = new Till(usd, address(fwd));
        vm.startPrank(client);
        usd.approve(address(other), type(uint256).max);
        uint256 oa = other.open(address(0), inviteAddr, RATE, BUDGET, "tab A elsewhere");
        vm.stopPrank();
        assertEq(oa, a, "same id on the other deployment");
        vm.prank(freelancer);
        vm.expectRevert(Till.BadInvite.selector);
        other.claim(oa, sigA);

        // On another chain the digest changes, so a replayed signature is rejected.
        vm.chainId(1);
        vm.prank(freelancer);
        vm.expectRevert(Till.BadInvite.selector);
        till.claim(a, sigA);
        vm.chainId(31337);

        // And on its own tab, contract and chain it works exactly once.
        vm.prank(freelancer);
        till.claim(a, sigA);
        assertEq(till.getTab(a).tab.payee, freelancer);
        vm.prank(freelancer);
        vm.expectRevert(Till.AlreadyClaimed.selector);
        till.claim(a, sigA);
    }

    function test_clientCannotClaimTheirOwnInvite() public {
        (address inviteAddr, uint256 inviteKey) = makeAddrAndKey("invite");
        vm.prank(client);
        uint256 id = till.open(address(0), inviteAddr, RATE, BUDGET, "");
        bytes memory sig = _inviteSig(inviteKey, address(till), id, client);
        vm.prank(client);
        vm.expectRevert(Till.SelfPay.selector);
        till.claim(id, sig);
    }

    // ------------------------------------------------------------- rate changes

    function test_rateChangeNeverTouchesARunningShift() public {
        uint256 id = _open();
        vm.prank(freelancer);
        till.clockIn(id);
        vm.warp(block.timestamp + 30 minutes);
        vm.prank(client);
        vm.expectRevert(Till.AlreadyIn.selector);
        till.setRate(id, 1);
        assertEq(till.earned(id), RATE / 2, "half an hour at the agreed rate");

        // Only once the clock is stopped can the rate change, and only for the next shift.
        vm.prank(freelancer);
        till.clockOut(id);
        vm.prank(client);
        till.setRate(id, RATE * 2);
        vm.prank(freelancer);
        till.clockIn(id);
        vm.warp(block.timestamp + 30 minutes);
        assertEq(till.earned(id), RATE / 2 + RATE, "the old half hour stays at the old rate");
    }

    // ------------------------------------------------------------- helpers

    function _open() internal returns (uint256 id) {
        vm.prank(client);
        id = till.open(freelancer, address(0), RATE, BUDGET, "Adversary");
    }

    function _openAndWork() internal returns (uint256 id) {
        id = _open();
        vm.prank(freelancer);
        till.clockIn(id);
        vm.warp(block.timestamp + 1 hours);
    }

    function _inviteSig(uint256 key, address at, uint256 id, address claimer) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encode(keccak256("TILL_INVITE_V1"), at, block.chainid, id, claimer));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, MessageHashUtils.toEthSignedMessageHash(digest));
        return abi.encodePacked(r, s, v);
    }
}
