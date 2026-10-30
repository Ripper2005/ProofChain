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

    bytes32 internal constant HASH = bytes32(uint256(1));
    string internal constant CID = "bafybeigdyrzt5sfp7kmew6xol2n3examplecid";
    string internal constant CODE = "PCB-2026-001";
    bytes32 internal constant EXPECTED_ID = 0x9d6be2557c721891700c118158cc27ec51fd21cd40d2b73a7670b7e1466936d2;

    function setUp() public {
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
        uint64 createdAt = uint64(block.timestamp);
        vm.expectEmit(true, true, false, true, address(registry));
        emit ProductRegistry.BatchRegistered(EXPECTED_ID, manufacturer, CODE, HASH, CID, createdAt);

        vm.prank(manufacturer);
        registry.registerBatch(CODE, HASH, CID);

        ProductRegistry.Batch memory batch = registry.getBatch(EXPECTED_ID);
        assertEq(batch.batchCode, CODE);
        assertEq(batch.manufacturer, manufacturer);
        assertEq(batch.currentCustodian, manufacturer);
        assertEq(batch.metadataHash, HASH);
        assertEq(batch.metadataCid, CID);
        assertEq(uint256(batch.status), uint256(ProductRegistry.Status.Active));
        assertEq(batch.createdAt, createdAt);

        ProductRegistry.PendingTransfer memory pending = registry.getPendingTransfer(EXPECTED_ID);
        assertFalse(pending.active);
        assertEq(pending.from, address(0));
        assertEq(pending.to, address(0));
        assertEq(pending.proposedAt, 0);
        assertEq(registry.getCustodyHistory(EXPECTED_ID).length, 0);
    }

    function test_registerUnauthorized() public {
        _expectRole(stranger, registry.MANUFACTURER_ROLE());
        vm.prank(stranger);
        registry.registerBatch(CODE, HASH, CID);
    }

    function test_registerUnauthorizedBeatsDuplicate() public {
        _register(CODE);
        _expectRole(stranger, registry.MANUFACTURER_ROLE());
        vm.prank(stranger);
        registry.registerBatch(CODE, HASH, CID);
    }

    function test_registerDuplicate() public {
        _register(CODE);
        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.BatchAlreadyExists.selector, EXPECTED_ID));
        vm.prank(manufacturer);
        registry.registerBatch(CODE, HASH, CID);
    }

    function test_registerRejectsBadBatchCode() public {
        vm.startPrank(manufacturer);
        vm.expectRevert(ProductRegistry.InvalidBatchCode.selector);
        registry.registerBatch("", HASH, CID);
        vm.expectRevert(ProductRegistry.InvalidBatchCode.selector);
        registry.registerBatch("PCB 2026", HASH, CID);
        vm.expectRevert(ProductRegistry.InvalidBatchCode.selector);
        registry.registerBatch("pcb_2026", HASH, CID);
        vm.expectRevert(ProductRegistry.InvalidBatchCode.selector);
        registry.registerBatch(_repeat("B", 65), HASH, CID);
        vm.stopPrank();
    }

    function test_registerRejectsBadMetadata() public {
        vm.startPrank(manufacturer);
        vm.expectRevert(ProductRegistry.InvalidMetadata.selector);
        registry.registerBatch(CODE, bytes32(0), CID);
        vm.expectRevert(ProductRegistry.InvalidMetadata.selector);
        registry.registerBatch(CODE, HASH, "");
        vm.expectRevert(ProductRegistry.InvalidMetadata.selector);
        registry.registerBatch(CODE, HASH, "bad cid");
        vm.expectRevert(ProductRegistry.InvalidMetadata.selector);
        registry.registerBatch(CODE, HASH, _repeat("c", 129));
        vm.stopPrank();
    }

    function test_twoHopCustodyIsOldestFirst() public {
        bytes32 id = _register(CODE);

        vm.prank(manufacturer);
        registry.proposeCustodyTransfer(id, distributor);
        vm.prank(distributor);
        registry.acceptCustodyTransfer(id);

        vm.prank(distributor);
        registry.proposeCustodyTransfer(id, retailer);
        vm.prank(retailer);
        registry.acceptCustodyTransfer(id);

        ProductRegistry.Batch memory batch = registry.getBatch(id);
        assertEq(batch.currentCustodian, retailer);
        assertEq(batch.manufacturer, manufacturer);

        ProductRegistry.CustodyRecord[] memory history = registry.getCustodyHistory(id);
        assertEq(history.length, 2);
        assertEq(history[0].from, manufacturer);
        assertEq(history[0].to, distributor);
        assertEq(history[1].from, distributor);
        assertEq(history[1].to, retailer);

        ProductRegistry.PendingTransfer memory pending = registry.getPendingTransfer(id);
        assertFalse(pending.active);
        assertEq(pending.from, address(0));
        assertEq(pending.to, address(0));
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

        vm.prank(manufacturer);
        registry.cancelCustodyTransfer(id);

        ProductRegistry.PendingTransfer memory pending = registry.getPendingTransfer(id);
        assertFalse(pending.active);
        assertEq(pending.from, address(0));
        assertEq(pending.to, address(0));
        assertEq(pending.proposedAt, 0);
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

        vm.expectEmit(true, true, false, true, address(registry));
        emit ProductRegistry.BatchRecalled(id, recaller, true, uint64(block.timestamp), "contaminated lot");

        vm.prank(recaller);
        registry.recallBatch(id, "contaminated lot");

        assertEq(uint256(registry.getBatch(id).status), uint256(ProductRegistry.Status.Recalled));
        ProductRegistry.PendingTransfer memory pending = registry.getPendingTransfer(id);
        assertFalse(pending.active);
        assertEq(pending.from, address(0));
        assertEq(pending.to, address(0));
    }

    function test_recallEmptyReason() public {
        bytes32 id = _register(CODE);
        vm.prank(recaller);
        registry.recallBatch(id, "");
        assertEq(uint256(registry.getBatch(id).status), uint256(ProductRegistry.Status.Recalled));
    }

    function test_recallReasonTooLong() public {
        bytes32 id = _register(CODE);
        vm.expectRevert(ProductRegistry.InvalidReason.selector);
        vm.prank(recaller);
        registry.recallBatch(id, _repeat("r", 129));
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
        registry.recallBatch(EXPECTED_ID, "");

        bytes32 id = _register(CODE);
        _expectRole(stranger, registry.RECALL_ROLE());
        vm.prank(stranger);
        registry.recallBatch(id, "");

        vm.prank(recaller);
        registry.recallBatch(id, "");

        vm.expectRevert(abi.encodeWithSelector(ProductRegistry.AlreadyRecalled.selector, id));
        vm.prank(stranger);
        registry.recallBatch(id, "");
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
        registry.registerBatch(code, HASH, CID);
        return registry.computeBatchId(code);
    }

    function _expectRole(address account, bytes32 role) internal {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, account, role)
        );
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
