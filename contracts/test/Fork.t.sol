// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Till} from "../src/Till.sol";

interface IAUSD {
    function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
}

interface IAgoraFaucet {
    function requestFunds(address recipient) external;
}

/// Rehearsal on a fork of Monad testnet with Agora's real AUSD (permit and transferWithAuthorization).
/// Run: forge test --match-contract Fork --fork-url monad_testnet
contract ForkTest is Test {
    IERC20 constant AUSD = IERC20(0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC);
    IAgoraFaucet constant FAUCET = IAgoraFaucet(0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C);

    function test_realAusdGaslessFlow() public {
        vm.skip(block.chainid != 10143); // only on a Monad testnet fork; shows as skipped elsewhere
        ERC2771Forwarder fwd = new ERC2771Forwarder("Till");
        Till till = new Till(AUSD, address(fwd));
        uint256 clientKey = 0xA11CE;
        address client = vm.addr(clientKey);
        address freelancer = makeAddr("freelancer");
        address keeper = makeAddr("keeper");

        // Agora's testnet faucet pays out AUSD; nothing is minted or dealt by hand.
        FAUCET.requestFunds(client);
        uint256 start = AUSD.balanceOf(client);
        assertGt(start, 25e6);

        // Client opens with a permit, relayed: no gas, no approval transaction.
        uint256 id = _openWithPermit(till, clientKey, freelancer);
        assertEq(AUSD.balanceOf(address(till)), 10e6);

        vm.prank(freelancer);
        till.clockIn(id);
        vm.warp(block.timestamp + 100);
        vm.prank(keeper);
        till.settle(id);
        assertEq(AUSD.balanceOf(freelancer), 1e6, "100 seconds at $36/h");

        // The freelancer sends their pay on with an EIP-3009 authorization a relayer submits.
        vm.prank(freelancer);
        AUSD.transfer(vm.addr(0xF2EE), 1e6);
        _cashOut(0xF2EE, keeper, 1e6);
        assertEq(AUSD.balanceOf(keeper), 1e6);

        vm.prank(client);
        till.close(id);
        assertEq(AUSD.balanceOf(client), start - 1e6);
    }

    function _openWithPermit(Till till, uint256 clientKey, address freelancer) internal returns (uint256) {
        address client = vm.addr(clientKey);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 permitHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                client, address(till), 10e6, IERC20Permit(address(AUSD)).nonces(client), deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(clientKey, MessageHashUtils.toTypedDataHash(IERC20Permit(address(AUSD)).DOMAIN_SEPARATOR(), permitHash));
        vm.prank(client);
        return till.openWithPermit(freelancer, address(0), 36e6, 10e6, "Fork rehearsal", deadline, v, r, s);
    }

    function _cashOut(uint256 key, address to, uint256 value) internal {
        address from = vm.addr(key);
        bytes32 nonce = keccak256("cash-out-1");
        bytes32 authHash = keccak256(
            abi.encode(
                keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),
                from, to, value, 0, block.timestamp + 1 hours, nonce
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, MessageHashUtils.toTypedDataHash(IERC20Permit(address(AUSD)).DOMAIN_SEPARATOR(), authHash));
        IAUSD(address(AUSD)).transferWithAuthorization(from, to, value, 0, block.timestamp + 1 hours, nonce, v, r, s);
    }
}
