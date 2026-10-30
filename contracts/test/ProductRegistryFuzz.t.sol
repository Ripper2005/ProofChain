// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ProductRegistry} from "../src/ProductRegistry.sol";

contract ProductRegistryFuzzTest is Test {
    ProductRegistry internal registry;

    address internal admin = makeAddr("admin");
    address internal manufacturer = makeAddr("manufacturer");
    address internal recaller = makeAddr("recaller");
    address internal distributor = makeAddr("distributor");

    bytes32 internal id;
    bytes32 internal constant HASH = bytes32(uint256(1));
    string internal constant CID = "bafybeigdyrzt5sfp7kmew6xol2n3examplecid";

    function setUp() public {
        registry = new ProductRegistry(admin);
        vm.startPrank(admin);
        registry.grantRole(registry.MANUFACTURER_ROLE(), manufacturer);
        registry.grantRole(registry.RECALL_ROLE(), recaller);
        vm.stopPrank();

        vm.prank(manufacturer);
        registry.registerBatch("PCB-2026-001", HASH, CID);
        id = registry.computeBatchId("PCB-2026-001");
    }

    function testFuzz_unauthorizedRegister(address caller, bytes32 hash) public {
        vm.assume(caller != manufacturer);
        vm.assume(hash != bytes32(0));

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, caller, registry.MANUFACTURER_ROLE()
            )
        );
        vm.prank(caller);
        registry.registerBatch("FUZZ-BATCH", hash, CID);
    }

    function testFuzz_unauthorizedRecall(address caller) public {
        vm.assume(caller != recaller);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, caller, registry.RECALL_ROLE()
            )
        );
        vm.prank(caller);
        registry.recallBatch(id, "");
    }

    function testFuzz_unauthorizedPropose(address caller, address to) public {
        vm.assume(caller != manufacturer);

        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.NotCurrentCustodian.selector, caller, manufacturer));
        vm.prank(caller);
        registry.proposeCustodyTransfer(id, to);
    }

    function testFuzz_unauthorizedAccept(address caller) public {
        vm.prank(manufacturer);
        registry.proposeCustodyTransfer(id, distributor);
        vm.assume(caller != distributor);

        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.NotPendingRecipient.selector, caller, distributor));
        vm.prank(caller);
        registry.acceptCustodyTransfer(id);
    }

    function testFuzz_unauthorizedCancel(address caller) public {
        vm.assume(caller != manufacturer);
        vm.prank(manufacturer);
        registry.proposeCustodyTransfer(id, distributor);

        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.NotCurrentCustodian.selector, caller, manufacturer));
        vm.prank(caller);
        registry.cancelCustodyTransfer(id);
    }
}
