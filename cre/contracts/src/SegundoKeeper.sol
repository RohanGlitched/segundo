// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IReceiver} from "./IReceiver.sol";

/// @notice The two calls the keeper needs from Till (the contract deployed under Segundo's working name).
interface ITill {
    function settleMany(uint256[] calldata ids) external returns (uint256 total);
    function settle(uint256 id) external returns (uint128);
}

/// @title SegundoKeeper
/// @notice Receives reports from Segundo's Chainlink CRE workflow. Each report does two jobs:
///         1. pays freelancers what they have earned so far, by calling Till.settleMany on the tabs the
///            workflow found owing (anyone may settle; money only ever goes to the payee), and
///         2. posts the USD exchange rates the DON agreed on, so income can be converted at on-chain rates.
/// @dev Only an allowed Chainlink forwarder may deliver reports: the KeystoneForwarder for deployed workflows
///      and the MockKeystoneForwarder used by `cre workflow simulate --broadcast`.
contract SegundoKeeper is IReceiver, Ownable {
    struct Rate {
        uint64 rateE6; // units of the currency per 1 USD, times 1e6
        uint64 at; // unix seconds (DON time) when the workflow produced the rate
    }

    uint256 public constant MAX_TABS = 64;
    uint256 public constant MAX_CURRENCIES = 16;

    ITill public immutable till;

    /// @notice Forwarders allowed to call onReport.
    mapping(address => bool) public isForwarder;
    /// @notice When set, only reports from this workflow ID are accepted. Off by default because the
    ///         simulation forwarder delivers no workflow metadata.
    bytes32 public expectedWorkflowId;

    /// @notice DON timestamp of the newest report whose rates were posted.
    uint64 public lastReportAt;
    /// @notice Reports processed, stale or not.
    uint256 public reports;
    /// @notice Total AUSD (6 dp) paid out to freelancers through this keeper.
    uint256 public totalPaid;

    mapping(bytes3 => Rate) private _rates;
    bytes3[] private _currencies;

    error NotForwarder(address sender);
    error WrongWorkflow(bytes32 received);
    error BadReport();

    event ForwarderSet(address indexed forwarder, bool allowed);
    event ExpectedWorkflowIdSet(bytes32 workflowId);
    event RatesPosted(uint64 indexed at, bytes3[] currencies, uint64[] ratesE6);
    event StaleRates(uint64 at, uint64 lastReportAt);
    event Kept(uint64 indexed at, uint256 tabs, uint256 paid);
    event SettleSkipped(uint256 indexed id);

    constructor(ITill till_, address[] memory forwarders, address owner_) Ownable(owner_) {
        till = till_;
        for (uint256 i; i < forwarders.length; ++i) _setForwarder(forwarders[i], true);
    }

    // ---------------------------------------------------------------- reports

    /// @inheritdoc IReceiver
    /// @dev report = abi.encode(uint256[] ids, bytes3[] currencies, uint64[] ratesE6, uint64 at)
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (!isForwarder[msg.sender]) revert NotForwarder(msg.sender);
        bytes32 wanted = expectedWorkflowId;
        if (wanted != bytes32(0)) {
            // metadata = workflowId (32) | workflowName (10) | workflowOwner (20) | reportId (2)
            bytes32 got = metadata.length >= 32 ? bytes32(metadata[:32]) : bytes32(0);
            if (got != wanted) revert WrongWorkflow(got);
        }

        (uint256[] memory ids, bytes3[] memory currencies, uint64[] memory ratesE6, uint64 at) =
            abi.decode(report, (uint256[], bytes3[], uint64[], uint64));
        if (
            currencies.length != ratesE6.length || currencies.length > MAX_CURRENCIES || ids.length > MAX_TABS
        ) revert BadReport();

        unchecked {
            ++reports;
        }

        // The receiver discards stale rates (a retried or out-of-order report). Settling is still safe:
        // it only ever pays what has been earned up to this block.
        if (at > lastReportAt) {
            lastReportAt = at;
            for (uint256 i; i < currencies.length; ++i) {
                if (currencies[i] == bytes3(0) || ratesE6[i] == 0) revert BadReport();
                if (_rates[currencies[i]].at == 0) _currencies.push(currencies[i]);
                _rates[currencies[i]] = Rate(ratesE6[i], at);
            }
            if (currencies.length > 0) emit RatesPosted(at, currencies, ratesE6);
        } else {
            emit StaleRates(at, lastReportAt);
        }

        if (ids.length > 0) {
            uint256 paid = _settle(ids);
            totalPaid += paid;
            emit Kept(at, ids.length, paid);
        }
    }

    /// @dev One tab that cannot be paid (say a frozen AUSD account) must not hold up the others or the rates.
    function _settle(uint256[] memory ids) private returns (uint256 paid) {
        try till.settleMany(ids) returns (uint256 total) {
            return total;
        } catch {
            for (uint256 i; i < ids.length; ++i) {
                try till.settle(ids[i]) returns (uint128 amount) {
                    paid += amount;
                } catch {
                    emit SettleSkipped(ids[i]);
                }
            }
        }
    }

    // ---------------------------------------------------------------- views

    /// @notice Latest rate for a currency (e.g. bytes3("PHP")): units per 1 USD times 1e6, and when it was set.
    function rateOf(bytes3 currency) external view returns (uint64 rateE6, uint64 at) {
        Rate memory r = _rates[currency];
        return (r.rateE6, r.at);
    }

    /// @notice Every currency the workflow has ever posted, with its latest rate.
    function allRates() external view returns (bytes3[] memory currencies, uint64[] memory ratesE6, uint64[] memory ats) {
        uint256 n = _currencies.length;
        currencies = _currencies;
        ratesE6 = new uint64[](n);
        ats = new uint64[](n);
        for (uint256 i; i < n; ++i) {
            Rate memory r = _rates[currencies[i]];
            ratesE6[i] = r.rateE6;
            ats[i] = r.at;
        }
    }

    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // ---------------------------------------------------------------- admin

    function setForwarder(address forwarder, bool allowed) external onlyOwner {
        _setForwarder(forwarder, allowed);
    }

    function setExpectedWorkflowId(bytes32 workflowId) external onlyOwner {
        expectedWorkflowId = workflowId;
        emit ExpectedWorkflowIdSet(workflowId);
    }

    function _setForwarder(address forwarder, bool allowed) private {
        if (forwarder == address(0)) revert NotForwarder(forwarder);
        isForwarder[forwarder] = allowed;
        emit ForwarderSet(forwarder, allowed);
    }
}
