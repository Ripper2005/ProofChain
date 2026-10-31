// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ProductRegistry} from "../src/ProductRegistry.sol";

contract ProductRegistryTest is Test {
    ProductRegistry internal registry;

    address internal admin = makeAddr("admin");
    address internal manufacturer = makeAddr("manufacturer");
    address internal recaller = makeAddr("recaller");
    address internal distributor = makeAddr("distributor");
    address internal retailer = makeAddr("retailer");
    address internal stranger = makeAddr("stranger");

    string internal constant CODE = "PCB-2026-001";
    bytes32 internal constant EXPECTED_ID = 0x9d6be2557c721891700c118158cc27ec51fd21cd40d2b73a7670b7e1466936d2;
    string internal constant DOCUMENT =
        '{"batchCode":"PCB-2026-001","description":"","imageCid":"","manufacturerName":"Demo Electronics Pvt. Ltd.","name":"STM32 Controller Development Board","productionDate":"2026-10-15","quantity":50,"schemaVersion":1,"sku":"CTRL-STM32-A"}';
    bytes32 internal constant GOLDEN_HASH = 0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752;
    string internal constant CID = "bafkreicjx37puhth4lglmhqqna5gjrcvjedfpputssey6isdy5slgiz7im";
    uint256 internal constant START = 1_793_000_000;

    function setUp() public {
        vm.warp(START);
        registry = new ProductRegistry(admin);
        vm.startPrank(admin);
        registry.grantRole(registry.MANUFACTURER_ROLE(), manufacturer);
        registry.grantRole(registry.RECALL_ROLE(), recaller);
        vm.stopPrank();
    }

    function test_goldenBatchId() public view {
        assertEq(registry.computeBatchId(CODE), EXPECTED_ID);
        assertEq(registry.MANUFACTURER_ROLE(), keccak256("MANUFACTURER_ROLE"));
        assertEq(registry.RECALL_ROLE(), keccak256("RECALL_ROLE"));
        assertEq(registry.MAX_BATCH_CODE_LENGTH(), 64);
        assertEq(registry.MAX_DOCUMENT_LENGTH(), 4096);
        assertEq(registry.MAX_CID_LENGTH(), 128);
        assertEq(registry.MAX_REASON_LENGTH(), 128);
    }

    function test_goldenDocumentYieldsGoldenHash() public {
        assertEq(bytes(DOCUMENT).length, 234);
        assertEq(keccak256(bytes(DOCUMENT)), GOLDEN_HASH);

        vm.prank(manufacturer);
        registry.registerBatch(CODE, DOCUMENT, CID);
        assertEq(registry.getBatch(EXPECTED_ID).metadataHash, GOLDEN_HASH);
    }

    function test_constructorRejectsZeroAdmin() public {
        vm.expectRevert(ProductRegistry.ZeroAddress.selector);
        new ProductRegistry(address(0));
    }

    function test_computeBatchIdRejectsInvalidCodes() public {
        vm.expectRevert(ProductRegistry.InvalidBatchCode.selector);
        registry.computeBatchId("");

        vm.expectRevert(ProductRegistry.InvalidBatchCode.selector);
        registry.computeBatchId("PCB_2026");

        vm.expectRevert(ProductRegistry.InvalidBatchCode.selector);
        registry.computeBatchId(_repeat("A", 65));
    }

    function test_registerHappyPath() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit ProductRegistry.BatchRegistered(EXPECTED_ID, manufacturer, CODE, GOLDEN_HASH, CID, uint64(START), DOCUMENT);

        vm.prank(manufacturer);
        registry.registerBatch(CODE, DOCUMENT, CID);

        ProductRegistry.Batch memory batch = registry.getBatch(EXPECTED_ID);
        assertEq(batch.batchCode, CODE);
        assertEq(batch.manufacturer, manufacturer);
        assertEq(batch.currentCustodian, manufacturer);
        assertEq(batch.metadataHash, GOLDEN_HASH);
        assertEq(batch.metadataCid, CID);
        assertEq(uint256(batch.status), uint256(ProductRegistry.Status.Active));
        assertEq(batch.createdAt, START);

        ProductRegistry.PendingTransfer memory pending = registry.getPendingTransfer(EXPECTED_ID);
        assertFalse(pending.active);
        assertEq(pending.from, address(0));
        assertEq(pending.to, address(0));
        assertEq(pending.proposedAt, 0);
        assertEq(registry.getCustodyHistory(EXPECTED_ID).length, 0);
    }

    function test_storedHashIsKeccakOfDocument() public {
        string memory document = "any bytes the manufacturer signed, not parsed by the contract";
        vm.prank(manufacturer);
        registry.registerBatch("PCB-2026-R01", document, CID);

        bytes32 stored = registry.getBatch(registry.computeBatchId("PCB-2026-R01")).metadataHash;
        assertEq(stored, keccak256(bytes(document)));
        assertTrue(stored != GOLDEN_HASH);
    }

    function test_registerUnauthorized() public {
        _expectRole(stranger, registry.MANUFACTURER_ROLE());
        vm.prank(stranger);
        registry.registerBatch(CODE, DOCUMENT, CID);
    }

    function test_registerUnauthorizedBeatsDuplicate() public {
        _register(CODE);
        _expectRole(stranger, registry.MANUFACTURER_ROLE());
        vm.prank(stranger);
        registry.registerBatch(CODE, DOCUMENT, CID);
    }

    function test_registerUnauthorizedBeatsInvalidInput() public {
        _expectRole(recaller, registry.MANUFACTURER_ROLE());
        vm.prank(recaller);
        registry.registerBatch("bad code", "", "");
    }

    function test_registerDuplicate() public {
        _register(CODE);
        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.BatchAlreadyExists.selector, EXPECTED_ID));
        vm.prank(manufacturer);
        registry.registerBatch(CODE, DOCUMENT, CID);
    }

    function test_registerRejectsBadBatchCode() public {
        vm.startPrank(manufacturer);
        vm.expectRevert(ProductRegistry.InvalidBatchCode.selector);
        registry.registerBatch("", DOCUMENT, CID);
        vm.expectRevert(ProductRegistry.InvalidBatchCode.selector);
        registry.registerBatch("PCB 2026", DOCUMENT, CID);
        vm.expectRevert(ProductRegistry.InvalidBatchCode.selector);
        registry.registerBatch("pcb_2026", DOCUMENT, CID);
        vm.expectRevert(ProductRegistry.InvalidBatchCode.selector);
        registry.registerBatch(_repeat("B", 65), DOCUMENT, CID);
        vm.stopPrank();
    }

    function test_registerChecksBatchCodeAndDuplicateBeforeDocument() public {
        vm.expectRevert(ProductRegistry.InvalidBatchCode.selector);
        vm.prank(manufacturer);
        registry.registerBatch("bad code", "", "");

        _register(CODE);
        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.BatchAlreadyExists.selector, EXPECTED_ID));
        vm.prank(manufacturer);
        registry.registerBatch(CODE, "", "");
    }

    function test_registerRejectsEmptyDocument() public {
        vm.expectRevert(ProductRegistry.InvalidMetadata.selector);
        vm.prank(manufacturer);
        registry.registerBatch(CODE, "", CID);
    }

    function test_registerRejectsDocumentOverLimit() public {
        vm.expectRevert(ProductRegistry.InvalidMetadata.selector);
        vm.prank(manufacturer);
        registry.registerBatch(CODE, _repeat("d", 4097), CID);
    }

    function test_registerAcceptsDocumentAtLimit() public {
        string memory document = _repeat("d", 4096);
        bytes32 hash = keccak256(bytes(document));

        vm.expectEmit(true, true, true, true, address(registry));
        emit ProductRegistry.BatchRegistered(EXPECTED_ID, manufacturer, CODE, hash, CID, uint64(START), document);
        vm.prank(manufacturer);
        registry.registerBatch(CODE, document, CID);

        assertEq(registry.getBatch(EXPECTED_ID).metadataHash, hash);
    }

    function test_registerRejectsBadCid() public {
        vm.startPrank(manufacturer);
        vm.expectRevert(ProductRegistry.InvalidMetadata.selector);
        registry.registerBatch(CODE, DOCUMENT, "");
        vm.expectRevert(ProductRegistry.InvalidMetadata.selector);
        registry.registerBatch(CODE, DOCUMENT, "bad cid");
        vm.expectRevert(ProductRegistry.InvalidMetadata.selector);
        registry.registerBatch(CODE, DOCUMENT, string(abi.encodePacked("bafk", bytes1(0x7f))));
        vm.expectRevert(ProductRegistry.InvalidMetadata.selector);
        registry.registerBatch(CODE, DOCUMENT, _repeat("c", 129));
        registry.registerBatch(CODE, DOCUMENT, _repeat("c", 128));
        vm.stopPrank();
    }

    function test_registerChecksDocumentBeforeCid() public {
        string memory badCid = string.concat(_repeat("c", 127), " ");
        uint256 emptyDocument = _invalidMetadataGas("", badCid);
        uint256 oneByteDocument = _invalidMetadataGas("d", badCid);

        // Both revert InvalidMetadata. The CID rule scans every character, so a document rejected first skips that
        // scan. The documents differ by one byte, so calldata pricing cannot hide the difference.
        assertLt(emptyDocument + 5000, oneByteDocument);
    }

    function test_twoHopCustodyIsOldestFirst() public {
        bytes32 id = _register(CODE);

        vm.warp(START + 60);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ProductRegistry.CustodyTransferProposed(id, manufacturer, distributor, uint64(START + 60));
        vm.prank(manufacturer);
        registry.proposeCustodyTransfer(id, distributor);

        ProductRegistry.PendingTransfer memory proposed = registry.getPendingTransfer(id);
        assertTrue(proposed.active);
        assertEq(proposed.from, manufacturer);
        assertEq(proposed.to, distributor);
        assertEq(proposed.proposedAt, START + 60);

        vm.warp(START + 120);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ProductRegistry.CustodyTransferred(id, manufacturer, distributor, uint64(START + 120));
        vm.prank(distributor);
        registry.acceptCustodyTransfer(id);

        vm.warp(START + 180);
        vm.prank(distributor);
        registry.proposeCustodyTransfer(id, retailer);
        vm.warp(START + 240);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ProductRegistry.CustodyTransferred(id, distributor, retailer, uint64(START + 240));
        vm.prank(retailer);
        registry.acceptCustodyTransfer(id);

        ProductRegistry.Batch memory batch = registry.getBatch(id);
        assertEq(batch.currentCustodian, retailer);
        assertEq(batch.manufacturer, manufacturer);
        assertEq(batch.metadataHash, GOLDEN_HASH);
        assertEq(batch.createdAt, START);

        ProductRegistry.CustodyRecord[] memory history = registry.getCustodyHistory(id);
        assertEq(history.length, 2);
        assertEq(history[0].from, manufacturer);
        assertEq(history[0].to, distributor);
        assertEq(history[0].timestamp, START + 120);
        assertEq(history[1].from, distributor);
        assertEq(history[1].to, retailer);
        assertEq(history[1].timestamp, START + 240);

        ProductRegistry.PendingTransfer memory pending = registry.getPendingTransfer(id);
        assertFalse(pending.active);
        assertEq(pending.from, address(0));
        assertEq(pending.to, address(0));
        assertEq(pending.proposedAt, 0);
    }

    function test_proposeRejectsBadRecipientsAndASecondProposal() public {
        bytes32 id = _register(CODE);

        vm.startPrank(manufacturer);
        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.InvalidRecipient.selector, address(0)));
        registry.proposeCustodyTransfer(id, address(0));
        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.InvalidRecipient.selector, manufacturer));
        registry.proposeCustodyTransfer(id, manufacturer);
        registry.proposeCustodyTransfer(id, distributor);
        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.TransferAlreadyPending.selector, id));
        registry.proposeCustodyTransfer(id, retailer);
        vm.stopPrank();
    }

    function test_proposeByStranger() public {
        bytes32 id = _register(CODE);
        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.NotCurrentCustodian.selector, stranger, manufacturer));
        vm.prank(stranger);
        registry.proposeCustodyTransfer(id, distributor);
    }

    function test_proposeMissingAndRecalled() public {
        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.BatchNotFound.selector, EXPECTED_ID));
        vm.prank(manufacturer);
        registry.proposeCustodyTransfer(EXPECTED_ID, distributor);

        bytes32 id = _register(CODE);
        vm.prank(recaller);
        registry.recallBatch(id, "");

        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.AlreadyRecalled.selector, id));
        vm.prank(stranger);
        registry.proposeCustodyTransfer(id, distributor);
    }

    function test_cancelClearsPendingAndEmits() public {
        bytes32 id = _register(CODE);
        vm.warp(START + 60);
        vm.prank(manufacturer);
        registry.proposeCustodyTransfer(id, distributor);

        vm.warp(START + 90);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ProductRegistry.CustodyTransferCancelled(id, manufacturer, distributor, uint64(START + 90));
        vm.prank(manufacturer);
        registry.cancelCustodyTransfer(id);

        ProductRegistry.PendingTransfer memory pending = registry.getPendingTransfer(id);
        assertFalse(pending.active);
        assertEq(pending.from, address(0));
        assertEq(pending.to, address(0));
        assertEq(pending.proposedAt, 0);
        assertEq(registry.getBatch(id).currentCustodian, manufacturer);
        assertEq(registry.getCustodyHistory(id).length, 0);
    }

    function test_acceptAndCancelAuthorization() public {
        bytes32 id = _register(CODE);
        vm.prank(manufacturer);
        registry.proposeCustodyTransfer(id, distributor);

        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.NotPendingRecipient.selector, stranger, distributor));
        vm.prank(stranger);
        registry.acceptCustodyTransfer(id);

        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.NotCurrentCustodian.selector, stranger, manufacturer));
        vm.prank(stranger);
        registry.cancelCustodyTransfer(id);

        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.NotCurrentCustodian.selector, distributor, manufacturer));
        vm.prank(distributor);
        registry.cancelCustodyTransfer(id);

        ProductRegistry.PendingTransfer memory pending = registry.getPendingTransfer(id);
        assertTrue(pending.active);
        assertEq(registry.getBatch(id).currentCustodian, manufacturer);
    }

    function test_acceptAndCancelWithoutPending() public {
        bytes32 id = _register(CODE);

        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.NoPendingTransfer.selector, id));
        vm.prank(distributor);
        registry.acceptCustodyTransfer(id);

        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.NoPendingTransfer.selector, id));
        vm.prank(manufacturer);
        registry.cancelCustodyTransfer(id);
    }

    function test_acceptAndCancelAfterRecall() public {
        bytes32 id = _register(CODE);
        vm.prank(manufacturer);
        registry.proposeCustodyTransfer(id, distributor);
        vm.prank(recaller);
        registry.recallBatch(id, "sealed");

        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.AlreadyRecalled.selector, id));
        vm.prank(distributor);
        registry.acceptCustodyTransfer(id);

        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.AlreadyRecalled.selector, id));
        vm.prank(manufacturer);
        registry.cancelCustodyTransfer(id);
    }

    function test_recallClearsPendingAndStoresReason() public {
        bytes32 id = _register(CODE);
        vm.prank(manufacturer);
        registry.proposeCustodyTransfer(id, distributor);

        vm.warp(START + 300);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ProductRegistry.BatchRecalled(id, recaller, true, uint64(START + 300), "Damaged seal");
        vm.prank(recaller);
        registry.recallBatch(id, "Damaged seal");

        assertEq(uint256(registry.getBatch(id).status), uint256(ProductRegistry.Status.Recalled));
        ProductRegistry.PendingTransfer memory pending = registry.getPendingTransfer(id);
        assertFalse(pending.active);
        assertEq(pending.from, address(0));
        assertEq(pending.to, address(0));
        assertEq(pending.proposedAt, 0);
    }

    function test_recallEmptyReason() public {
        bytes32 id = _register(CODE);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ProductRegistry.BatchRecalled(id, recaller, false, uint64(START), "");
        vm.prank(recaller);
        registry.recallBatch(id, "");
        assertEq(uint256(registry.getBatch(id).status), uint256(ProductRegistry.Status.Recalled));
    }

    function test_recallReasonLength() public {
        bytes32 id = _register(CODE);
        vm.expectRevert(ProductRegistry.InvalidReason.selector);
        vm.prank(recaller);
        registry.recallBatch(id, _repeat("r", 129));

        vm.prank(recaller);
        registry.recallBatch(id, _repeat("r", 128));
        assertEq(uint256(registry.getBatch(id).status), uint256(ProductRegistry.Status.Recalled));
    }

    function test_secondRecall() public {
        bytes32 id = _register(CODE);
        vm.prank(recaller);
        registry.recallBatch(id, "");
        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.AlreadyRecalled.selector, id));
        vm.prank(recaller);
        registry.recallBatch(id, "again");
    }

    function test_recallCheckOrder() public {
        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.BatchNotFound.selector, EXPECTED_ID));
        vm.prank(stranger);
        registry.recallBatch(EXPECTED_ID, _repeat("r", 129));

        bytes32 id = _register(CODE);
        _expectRole(stranger, registry.RECALL_ROLE());
        vm.prank(stranger);
        registry.recallBatch(id, _repeat("r", 129));

        _expectRole(manufacturer, registry.RECALL_ROLE());
        vm.prank(manufacturer);
        registry.recallBatch(id, "");

        vm.prank(recaller);
        registry.recallBatch(id, "");

        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.AlreadyRecalled.selector, id));
        vm.prank(stranger);
        registry.recallBatch(id, _repeat("r", 129));
    }

    function test_readsRevertWhenMissing() public {
        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.BatchNotFound.selector, EXPECTED_ID));
        registry.getBatch(EXPECTED_ID);
        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.BatchNotFound.selector, EXPECTED_ID));
        registry.getPendingTransfer(EXPECTED_ID);
        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.BatchNotFound.selector, EXPECTED_ID));
        registry.getCustodyHistory(EXPECTED_ID);
    }

    function _register(string memory code) internal returns (bytes32 id) {
        vm.prank(manufacturer);
        registry.registerBatch(code, DOCUMENT, CID);
        return registry.computeBatchId(code);
    }

    function _invalidMetadataGas(string memory document, string memory cid) internal returns (uint256 used) {
        vm.prank(manufacturer);
        uint256 before = gasleft();
        try registry.registerBatch(CODE, document, cid) {
            revert("registration should have reverted");
        } catch (bytes memory reason) {
            used = before - gasleft();
            assertEq(reason, abi.encodeWithSelector(ProductRegistry.InvalidMetadata.selector));
        }
    }

    function _expectRole(address account, bytes32 role) internal {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, account, role));
    }

    function _repeat(string memory seed, uint256 count) internal pure returns (string memory) {
        bytes memory unit = bytes(seed);
        bytes memory out = new bytes(unit.length * count);
        for (uint256 i = 0; i < count; ++i) {
            for (uint256 j = 0; j < unit.length; ++j) {
                out[(i * unit.length) + j] = unit[j];
            }
        }
        return string(out);
    }
}
