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
    string internal constant DOCUMENT =
        '{"batchCode":"PCB-2026-001","description":"","imageCid":"","manufacturerName":"Demo Electronics Pvt. Ltd.","name":"STM32 Controller Development Board","productionDate":"2026-10-15","quantity":50,"schemaVersion":1,"sku":"CTRL-STM32-A"}';
    string internal constant CID = "bafkreicjx37puhth4lglmhqqna5gjrcvjedfpputssey6isdy5slgiz7im";
    string internal constant FUZZ_CODE = "FUZZ-BATCH";

    function setUp() public {
        registry = new ProductRegistry(admin);
        vm.startPrank(admin);
        registry.grantRole(registry.MANUFACTURER_ROLE(), manufacturer);
        registry.grantRole(registry.RECALL_ROLE(), recaller);
        vm.stopPrank();

        vm.prank(manufacturer);
        registry.registerBatch("PCB-2026-001", DOCUMENT, CID);
        id = registry.computeBatchId("PCB-2026-001");
    }

    function testFuzz_unauthorizedRegister(address caller, string calldata document) public {
        vm.assume(caller != manufacturer);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, caller, registry.MANUFACTURER_ROLE()
            )
        );
        vm.prank(caller);
        registry.registerBatch(FUZZ_CODE, document, CID);
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

    function testFuzz_documentLength(uint256 length) public {
        _checkDocumentLength(bound(length, 0, 2 * registry.MAX_DOCUMENT_LENGTH() + 1));
    }

    function testFuzz_documentLengthNearLimit(uint256 length) public {
        uint256 limit = registry.MAX_DOCUMENT_LENGTH();
        _checkDocumentLength(bound(length, limit - 32, limit + 32));
    }

    function _checkDocumentLength(uint256 length) internal {
        string memory document = _document(length);
        bool accepted = length >= 1 && length <= registry.MAX_DOCUMENT_LENGTH();
        if (!accepted) vm.expectRevert(ProductRegistry.InvalidMetadata.selector);
        vm.prank(manufacturer);
        registry.registerBatch(FUZZ_CODE, document, CID);
        if (accepted) {
            assertEq(registry.getBatch(registry.computeBatchId(FUZZ_CODE)).metadataHash, keccak256(bytes(document)));
        }
    }

    function _document(uint256 length) internal pure returns (string memory) {
        bytes memory out = new bytes(length);
        for (uint256 i = 0; i < length; ++i) {
            out[i] = bytes1(uint8(0x61 + (i % 26)));
        }
        return string(out);
    }
}
