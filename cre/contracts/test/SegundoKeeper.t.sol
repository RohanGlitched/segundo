// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {SegundoKeeper, ITill} from "../src/SegundoKeeper.sol";
import {IReceiver} from "../src/IReceiver.sol";

/// @dev Stands in for Till: pays 1 AUSD unit per id, and can be told to fail a batch or a single tab.
contract MockTill is ITill {
    uint256[] public lastBatch;
    uint256 public batches;
    bool public failBatch;
    uint256 public badId;

    function setFailBatch(bool on, uint256 id) external {
        failBatch = on;
        badId = id;
    }

    function settleMany(uint256[] calldata ids) external returns (uint256 total) {
        if (failBatch) revert("batch");
        lastBatch = ids;
        ++batches;
        return ids.length * 1_000_000;
    }

    function settle(uint256 id) external view returns (uint128) {
        if (id == badId) revert("frozen");
        return 1_000_000;
    }

    function lastBatchLength() external view returns (uint256) {
        return lastBatch.length;
    }
}

contract SegundoKeeperTest is Test {
    // Monad testnet forwarders from the CRE Forwarder Directory.
    address constant MOCK_FORWARDER = 0xB9F79d863261869B234c481D1f9A7af84AeAd192;
    address constant KEYSTONE_FORWARDER = 0xF8344CFd5c43616a4366C34E3EEE75af79a74482;

    MockTill till;
    SegundoKeeper keeper;
    address owner = makeAddr("owner");

    event RatesPosted(uint64 indexed at, bytes3[] currencies, uint64[] ratesE6);
    event Kept(uint64 indexed at, uint256 tabs, uint256 paid);
    event SettleSkipped(uint256 indexed id);

    function setUp() public {
        till = new MockTill();
        address[] memory fwd = new address[](2);
        fwd[0] = MOCK_FORWARDER;
        fwd[1] = KEYSTONE_FORWARDER;
        keeper = new SegundoKeeper(till, fwd, owner);
    }

    function _report(uint256[] memory ids, uint64 at) internal pure returns (bytes memory) {
        bytes3[] memory cur = new bytes3[](3);
        cur[0] = "PHP";
        cur[1] = "NGN";
        cur[2] = "INR";
        uint64[] memory rates = new uint64[](3);
        rates[0] = 62_757_000;
        rates[1] = 1_530_120_000;
        rates[2] = 95_780_000;
        return abi.encode(ids, cur, rates, at);
    }

    function _ids(uint256 n) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i; i < n; ++i) ids[i] = i + 1;
    }

    function test_rejectsNonForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(SegundoKeeper.NotForwarder.selector, address(this)));
        keeper.onReport("", _report(_ids(2), 100));

        vm.prank(owner);
        keeper.setForwarder(MOCK_FORWARDER, false);
        vm.prank(MOCK_FORWARDER);
        vm.expectRevert(abi.encodeWithSelector(SegundoKeeper.NotForwarder.selector, MOCK_FORWARDER));
        keeper.onReport("", _report(_ids(2), 100));
    }

    function test_onlyOwnerAdmin() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        keeper.setForwarder(address(this), true);
    }

    function test_settlesAndEmitsRates() public {
        bytes3[] memory cur = new bytes3[](3);
        cur[0] = "PHP";
        cur[1] = "NGN";
        cur[2] = "INR";
        uint64[] memory rates = new uint64[](3);
        rates[0] = 62_757_000;
        rates[1] = 1_530_120_000;
        rates[2] = 95_780_000;

        vm.expectEmit(true, false, false, true, address(keeper));
        emit RatesPosted(1_791_900_000, cur, rates);
        vm.expectEmit(true, false, false, true, address(keeper));
        emit Kept(1_791_900_000, 3, 3_000_000);

        vm.prank(KEYSTONE_FORWARDER);
        keeper.onReport("", _report(_ids(3), 1_791_900_000));

        assertEq(till.batches(), 1);
        assertEq(till.lastBatchLength(), 3);
        assertEq(keeper.totalPaid(), 3_000_000);
        assertEq(keeper.reports(), 1);
        (uint64 php, uint64 at) = keeper.rateOf("PHP");
        assertEq(php, 62_757_000);
        assertEq(at, 1_791_900_000);
        (bytes3[] memory all,,) = keeper.allRates();
        assertEq(all.length, 3);
    }

    function test_staleRatesIgnoredButStillSettles() public {
        vm.startPrank(MOCK_FORWARDER);
        keeper.onReport("", _report(_ids(1), 200));
        keeper.onReport("", _report(_ids(2), 150));
        vm.stopPrank();
        assertEq(keeper.lastReportAt(), 200);
        (, uint64 at) = keeper.rateOf("NGN");
        assertEq(at, 200);
        assertEq(till.batches(), 2);
        assertEq(keeper.totalPaid(), 3_000_000);
    }

    function test_oneBadTabDoesNotBlockTheRest() public {
        till.setFailBatch(true, 2);
        vm.expectEmit(true, false, false, false, address(keeper));
        emit SettleSkipped(2);
        vm.prank(MOCK_FORWARDER);
        keeper.onReport("", _report(_ids(3), 300));
        assertEq(keeper.totalPaid(), 2_000_000);
        (uint64 inr,) = keeper.rateOf("INR");
        assertEq(inr, 95_780_000);
    }

    function test_ratesOnlyReport() public {
        vm.prank(MOCK_FORWARDER);
        keeper.onReport("", _report(new uint256[](0), 400));
        assertEq(till.batches(), 0);
        assertEq(keeper.lastReportAt(), 400);
    }

    function test_rejectsMalformedReport() public {
        bytes3[] memory cur = new bytes3[](2);
        cur[0] = "PHP";
        cur[1] = "EUR";
        uint64[] memory rates = new uint64[](1);
        rates[0] = 1;
        vm.prank(MOCK_FORWARDER);
        vm.expectRevert(SegundoKeeper.BadReport.selector);
        keeper.onReport("", abi.encode(new uint256[](0), cur, rates, uint64(1)));
    }

    function test_workflowIdCheck() public {
        bytes32 id = keccak256("segundo-keeper");
        vm.prank(owner);
        keeper.setExpectedWorkflowId(id);

        bytes memory good = abi.encodePacked(id, bytes10("name"), address(0xBEEF), bytes2(0));
        bytes memory bad = abi.encodePacked(bytes32(uint256(1)), bytes10("name"), address(0xBEEF), bytes2(0));

        vm.startPrank(KEYSTONE_FORWARDER);
        vm.expectRevert(abi.encodeWithSelector(SegundoKeeper.WrongWorkflow.selector, bytes32(uint256(1))));
        keeper.onReport(bad, _report(_ids(1), 500));
        keeper.onReport(good, _report(_ids(1), 500));
        vm.stopPrank();
        assertEq(keeper.reports(), 1);
    }

    function test_supportsInterface() public view {
        assertTrue(keeper.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(keeper.supportsInterface(type(IERC165).interfaceId));
        assertFalse(keeper.supportsInterface(0xdeadbeef));
    }
}

/// @dev Runs against the live Till on a Monad testnet fork (nothing is sent):
///      forge test --mt test_fork --fork-url https://testnet-rpc.monad.xyz
contract SegundoKeeperForkTest is Test {
    address constant TILL = 0xEb6C2C519C9bcc4495364C34aC116C20098113D1;

    function test_fork_settlesLiveTabs() public {
        if (block.chainid != 10143) return;
        address[] memory fwd = new address[](1);
        fwd[0] = address(this);
        SegundoKeeper keeper = new SegundoKeeper(ITill(TILL), fwd, address(this));
        uint256[] memory ids = new uint256[](3);
        ids[0] = 1;
        ids[1] = 2;
        ids[2] = 3;
        bytes3[] memory cur = new bytes3[](1);
        cur[0] = "EUR";
        uint64[] memory rates = new uint64[](1);
        rates[0] = 894_370;
        keeper.onReport("", abi.encode(ids, cur, rates, uint64(block.timestamp)));
        assertEq(keeper.reports(), 1);
    }

    /// @dev Delivers a report through the real CRE MockKeystoneForwarder to the deployed SegundoKeeper,
    ///      the same path `cre workflow simulate --broadcast` takes.
    function test_fork_mockForwarderDelivers() public {
        if (block.chainid != 10143) return;
        SegundoKeeper keeper = SegundoKeeper(0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D);
        address mockForwarder = 0xB9F79d863261869B234c481D1f9A7af84AeAd192;
        uint256 before = keeper.reports();

        uint256[] memory ids = new uint256[](0);
        bytes3[] memory cur = new bytes3[](1);
        cur[0] = "PHP";
        uint64[] memory rates = new uint64[](1);
        rates[0] = 62_757_000;
        bytes memory payload = abi.encode(ids, cur, rates, uint64(block.timestamp));
        // version | executionId | timestamp | donId | donConfigVersion | workflowId | workflowName | owner | reportId
        bytes memory header = abi.encodePacked(
            uint8(1), bytes32(uint256(1)), uint32(1), uint32(1), uint32(1), bytes32(0), bytes10(0), address(0), bytes2(0)
        );
        assertEq(header.length, 109);

        (bool ok,) = mockForwarder.call(
            abi.encodeWithSignature(
                "report(address,bytes,bytes,bytes[])", address(keeper), bytes.concat(header, payload), bytes(""), new bytes[](0)
            )
        );
        assertTrue(ok);
        assertEq(keeper.reports(), before + 1);
        (uint64 php,) = keeper.rateOf("PHP");
        assertEq(php, 62_757_000);
    }
}
