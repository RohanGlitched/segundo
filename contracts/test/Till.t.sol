// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Till} from "../src/Till.sol";

/// A 6-decimal dollar with permit, like Agora's AUSD.
contract TestDollar is ERC20, ERC20Permit {
    constructor() ERC20("Agora Dollar", "AUSD") ERC20Permit("Agora Dollar") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TillTest is Test {
    TestDollar usd;
    ERC2771Forwarder fwd;
    Till till;

    uint256 clientKey = 0xC11E;
    uint256 freelancerKey = 0xF2EE;
    address client;
    address freelancer;
    address keeper = makeAddr("keeper");

    uint64 constant RATE = 30e6; // $30 an hour
    uint128 constant BUDGET = 100e6;

    function setUp() public {
        vm.warp(1_790_000_000);
        usd = new TestDollar();
        fwd = new ERC2771Forwarder("Till");
        till = new Till(usd, address(fwd));
        client = vm.addr(clientKey);
        freelancer = vm.addr(freelancerKey);
        usd.mint(client, 1_000e6);
        vm.prank(client);
        usd.approve(address(till), type(uint256).max);
    }

    function _open() internal returns (uint256 id) {
        vm.prank(client);
        id = till.open(freelancer, address(0), RATE, BUDGET, "Logo for Northwind");
    }

    function test_paysBySecondAndRefundsTheRest() public {
        uint256 id = _open();
        vm.prank(freelancer);
        till.clockIn(id);

        vm.warp(block.timestamp + 1);
        assertEq(till.earned(id), RATE / 3600, "one second of pay");

        vm.warp(block.timestamp + 3599);
        assertEq(till.earned(id), RATE, "an hour of pay");

        vm.prank(keeper);
        till.settle(id);
        assertEq(usd.balanceOf(freelancer), RATE, "settled to the freelancer by anyone");

        vm.warp(block.timestamp + 1800);
        vm.prank(client);
        till.close(id);
        assertEq(usd.balanceOf(freelancer), RATE + RATE / 2, "paid for 90 minutes");
        assertEq(usd.balanceOf(client), 1_000e6 - RATE - RATE / 2, "the rest came back");
        assertEq(usd.balanceOf(address(till)), 0);
    }

    function test_noPayWhileClockedOut() public {
        uint256 id = _open();
        vm.startPrank(freelancer);
        till.clockIn(id);
        vm.warp(block.timestamp + 600);
        till.clockOut(id);
        vm.warp(block.timestamp + 10_000);
        assertEq(till.earned(id), RATE / 6, "only the 10 minutes clocked in");
        till.clockIn(id);
        vm.warp(block.timestamp + 600);
        vm.stopPrank();
        assertEq(till.earned(id), RATE / 3);
    }

    function test_clientHoldStopsTheClock() public {
        uint256 id = _open();
        vm.prank(freelancer);
        till.clockIn(id);
        vm.warp(block.timestamp + 360);
        vm.prank(client);
        till.hold(id, true);
        vm.warp(block.timestamp + 3600);
        assertEq(till.earned(id), RATE / 10);

        vm.prank(freelancer);
        vm.expectRevert(Till.OnHold.selector);
        till.clockIn(id);

        vm.prank(client);
        till.hold(id, false);
        vm.prank(freelancer);
        till.clockIn(id);
    }

    function test_budgetCapsPayAndTopUpRestartsTheShift() public {
        uint256 id = _open();
        vm.prank(freelancer);
        till.clockIn(id);
        vm.warp(block.timestamp + 10 hours);
        assertEq(till.earned(id), BUDGET, "capped at the budget");
        assertEq(till.getTab(id).runway, 0);

        vm.prank(client);
        till.topUp(id, 30e6);
        assertEq(till.earned(id), BUDGET, "time past the old budget is not owed");
        vm.warp(block.timestamp + 1 hours);
        assertEq(till.earned(id), BUDGET + 30e6);
    }

    function test_onlyTheRightPeopleTouchTheClock() public {
        uint256 id = _open();
        address stranger = makeAddr("stranger");

        vm.prank(client);
        vm.expectRevert(Till.NotPayee.selector);
        till.clockIn(id);

        vm.prank(freelancer);
        till.clockIn(id);

        vm.prank(stranger);
        vm.expectRevert(Till.NotParty.selector);
        till.clockOut(id);

        vm.prank(stranger);
        vm.expectRevert(Till.NotParty.selector);
        till.close(id);

        vm.prank(client);
        vm.expectRevert(Till.AlreadyIn.selector);
        till.setRate(id, 40e6);

        vm.prank(freelancer);
        vm.expectRevert(Till.NotPayer.selector);
        till.hold(id, true);
    }

    function test_inviteClaimCannotBeStolen() public {
        (address inviteAddr, uint256 inviteKey) = makeAddrAndKey("invite");
        vm.prank(client);
        uint256 id = till.open(address(0), inviteAddr, RATE, BUDGET, "Translation, EN to PT");

        // A watcher copies a signature made for the freelancer: it doesn't work for them.
        bytes memory sig = _inviteSig(inviteKey, id, freelancer);
        address thief = makeAddr("thief");
        vm.prank(thief);
        vm.expectRevert(Till.BadInvite.selector);
        till.claim(id, sig);

        vm.prank(freelancer);
        till.claim(id, sig);
        assertEq(till.getTab(id).tab.payee, freelancer);
        assertEq(till.tabsOf(freelancer)[0], id);

        bytes memory thiefSig = _inviteSig(inviteKey, id, thief);
        vm.prank(thief);
        vm.expectRevert(Till.AlreadyClaimed.selector);
        till.claim(id, thiefSig);
    }

    function test_unclaimedInviteRefundsInFull() public {
        (address inviteAddr,) = makeAddrAndKey("invite");
        vm.prank(client);
        uint256 id = till.open(address(0), inviteAddr, RATE, BUDGET, "");
        vm.prank(client);
        till.close(id);
        assertEq(usd.balanceOf(client), 1_000e6);
    }

    function test_settleManyPaysEveryTab() public {
        uint256[] memory ids = new uint256[](3);
        address[3] memory people = [makeAddr("ana"), makeAddr("tunde"), makeAddr("priya")];
        for (uint256 i; i < 3; ++i) {
            vm.prank(client);
            ids[i] = till.open(people[i], address(0), RATE, BUDGET, "");
            vm.prank(people[i]);
            till.clockIn(ids[i]);
        }
        vm.warp(block.timestamp + 120);
        vm.prank(keeper);
        uint256 total = till.settleMany(ids);
        assertEq(total, 3 * (120 * uint256(RATE) / 3600));
        for (uint256 i; i < 3; ++i) assertEq(usd.balanceOf(people[i]), 120 * uint256(RATE) / 3600);
    }

    /// The whole flow with no gas on either side: a relayer submits signed requests through the forwarder.
    function test_gaslessOpenWithPermitAndClockIn() public {
        address newClient = vm.addr(0xBEEF);
        usd.mint(newClient, 50e6);
        assertEq(newClient.balance, 0);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(0xBEEF, newClient, 20e6, deadline);
        bytes memory call = abi.encodeCall(Till.openWithPermit, (freelancer, address(0), RATE, 20e6, "Weekly design retainer", deadline, v, r, s));
        vm.prank(keeper);
        fwd.execute(_request(0xBEEF, newClient, call));
        uint256 id = till.tabCount();
        assertEq(till.getTab(id).tab.payer, newClient);
        assertEq(usd.balanceOf(address(till)), 20e6);

        vm.prank(keeper);
        fwd.execute(_request(freelancerKey, freelancer, abi.encodeCall(Till.clockIn, (id))));
        assertGt(till.getTab(id).tab.since, 0);
    }

    /// Each block with activity links back to the previous one, so the history is walkable one exact block at a time.
    function test_activityChainLinksEveryBlock() public {
        vm.roll(100);
        vm.recordLogs();
        uint256 id = _open();
        vm.roll(105);
        vm.prank(freelancer);
        till.clockIn(id);
        vm.roll(110);
        vm.warp(block.timestamp + 60);
        till.settle(id);
        vm.prank(client);
        till.close(id); // same block as the settle: no second link

        bytes32 topic = keccak256("Activity(uint256,uint64)");
        uint64[] memory prevs = new uint64[](4);
        uint256 n;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == topic) prevs[n++] = abi.decode(logs[i].data, (uint64));
        }
        assertEq(n, 3, "one link per block");
        assertEq(prevs[0], 0);
        assertEq(prevs[1], 100);
        assertEq(prevs[2], 105);
        assertEq(till.getTab(id).tab.lastBlock, 110);
    }

    function test_profiles() public {
        vm.prank(freelancer);
        till.setProfile("Priya Nair", "Pune, India", "INR");
        Till.Profile memory p = till.profileOf(freelancer);
        assertEq(p.name, "Priya Nair");
        assertEq(p.currency, bytes3("INR"));

        vm.prank(freelancer);
        vm.expectRevert(Till.TextTooLong.selector);
        till.setProfile("a name that is much too long for anyone to need on a tab", "", "INR");
    }

    /// Whatever the shifts, holds and settles, the freelancer gets exactly what they earned and the client gets the rest.
    function testFuzz_moneyIsConserved(uint32[6] memory gaps, uint8 pattern, uint64 rate, uint128 budget) public {
        rate = uint64(bound(rate, 1, 500e6));
        budget = uint128(bound(budget, 1, 1_000e6));
        vm.prank(client);
        uint256 id = till.open(freelancer, address(0), rate, budget, "");
        for (uint256 i; i < 6; ++i) {
            uint8 step = (pattern >> i) & 1;
            Till.TabView memory v = till.getTab(id);
            if (v.tab.since == 0 && v.earned < budget && step == 1) {
                vm.prank(freelancer);
                till.clockIn(id);
            } else if (v.tab.since != 0) {
                vm.prank(i % 2 == 0 ? freelancer : client);
                till.clockOut(id);
            }
            vm.warp(block.timestamp + bound(gaps[i], 0, 30 days));
            if (i == 3) till.settle(id);
            uint256 e = till.earned(id);
            assertLe(e, budget);
            assertLe(till.getTab(id).tab.paid, e);
        }
        uint256 earnedAtClose = till.earned(id);
        vm.prank(client);
        till.close(id);
        assertEq(usd.balanceOf(freelancer), earnedAtClose);
        assertEq(usd.balanceOf(client), 1_000e6 - earnedAtClose);
        assertEq(usd.balanceOf(address(till)), 0);
    }

    // ---------------------------------------------------------------- helpers

    function _inviteSig(uint256 key, uint256 id, address claimer) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(till.inviteDigest(id, claimer));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _permitSig(uint256 key, address owner, uint256 value, uint256 deadline) internal view returns (uint8, bytes32, bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                address(till),
                value,
                usd.nonces(owner),
                deadline
            )
        );
        return vm.sign(key, MessageHashUtils.toTypedDataHash(usd.DOMAIN_SEPARATOR(), structHash));
    }

    function _request(uint256 key, address from, bytes memory data) internal view returns (ERC2771Forwarder.ForwardRequestData memory req) {
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"),
                from,
                address(till),
                0,
                500_000,
                fwd.nonces(from),
                deadline,
                keccak256(data)
            )
        );
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = fwd.eip712Domain();
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, MessageHashUtils.toTypedDataHash(domain, structHash));
        req = ERC2771Forwarder.ForwardRequestData({
            from: from, to: address(till), value: 0, gas: 500_000, deadline: deadline, data: data, signature: abi.encodePacked(r, s, v)
        });
    }
}
