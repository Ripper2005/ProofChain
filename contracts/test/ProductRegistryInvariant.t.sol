// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProductRegistry} from "../src/ProductRegistry.sol";

contract Handler is Test {
    ProductRegistry public immutable registry;
    address public immutable manufacturer;
    address public immutable recaller;
    address public immutable alice;
    address public immutable bob;

    bytes32[] public batchIds;
    mapping(bytes32 id => bool seen) public known;
    mapping(bytes32 id => bool recalled) public wasRecalled;
    mapping(bytes32 id => uint256 count) public acceptCount;
    mapping(bytes32 id => address custodian) public expectedCustodian;
    mapping(bytes32 id => address maker) public expectedManufacturer;

    string internal constant CID = "bafybeigdyrzt5sfp7kmew6xol2n3examplecid";

    constructor(ProductRegistry registry_, address manufacturer_, address recaller_, address alice_, address bob_) {
        registry = registry_;
        manufacturer = manufacturer_;
        recaller = recaller_;
        alice = alice_;
        bob = bob_;
    }

    function register(uint256 seed, uint256 hashSeed) external {
        string memory code = _code(seed);
        bytes32 hash = bytes32(bound(hashSeed, 1, type(uint256).max));
        vm.prank(manufacturer);
        try registry.registerBatch(code, hash, CID) {
            bytes32 id = registry.computeBatchId(code);
            if (!known[id]) {
                known[id] = true;
                batchIds.push(id);
                expectedManufacturer[id] = manufacturer;
                expectedCustodian[id] = manufacturer;
            }
        } catch {}
    }

    function propose(uint256 batchSeed, uint256 recipientSeed) external {
        bytes32 id = _existing(batchSeed);
        if (id == bytes32(0)) return;
        address custodian = registry.getBatch(id).currentCustodian;
        address to = recipientSeed % 2 == 0 ? alice : bob;
        vm.prank(custodian);
        try registry.proposeCustodyTransfer(id, to) {} catch {}
    }

    function accept(uint256 batchSeed) external {
        bytes32 id = _existing(batchSeed);
        if (id == bytes32(0)) return;
        ProductRegistry.PendingTransfer memory pending = registry.getPendingTransfer(id);
        if (!pending.active) return;
        vm.prank(pending.to);
        try registry.acceptCustodyTransfer(id) {
            acceptCount[id] += 1;
            expectedCustodian[id] = pending.to;
        } catch {}
    }

    function cancel(uint256 batchSeed) external {
        bytes32 id = _existing(batchSeed);
        if (id == bytes32(0)) return;
        address custodian = registry.getBatch(id).currentCustodian;
        vm.prank(custodian);
        try registry.cancelCustodyTransfer(id) {} catch {}
    }

    function recall(uint256 batchSeed, uint8 reasonBytes) external {
        bytes32 id = _existing(batchSeed);
        if (id == bytes32(0)) return;
        string memory reason = reasonBytes == 0 ? "" : "recalled";
        vm.prank(recaller);
        try registry.recallBatch(id, reason) {
            wasRecalled[id] = true;
        } catch {}
    }

    function batchCount() external view returns (uint256) {
        return batchIds.length;
    }

    function _existing(uint256 seed) internal view returns (bytes32) {
        uint256 count = batchIds.length;
        if (count == 0) return bytes32(0);
        return batchIds[seed % count];
    }

    function _code(uint256 seed) internal pure returns (string memory) {
        uint256 n = bound(seed, 1, 8);
        return string.concat("B", vm.toString(n));
    }
}

contract ProductRegistryInvariantTest is Test {
    ProductRegistry internal registry;
    Handler internal handler;

    function setUp() public {
        registry = new ProductRegistry(address(this));
        address manufacturer = makeAddr("manufacturer");
        address recaller = makeAddr("recaller");
        registry.grantRole(registry.MANUFACTURER_ROLE(), manufacturer);
        registry.grantRole(registry.RECALL_ROLE(), recaller);

        handler = new Handler(registry, manufacturer, recaller, makeAddr("alice"), makeAddr("bob"));

        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = Handler.register.selector;
        selectors[1] = Handler.propose.selector;
        selectors[2] = Handler.accept.selector;
        selectors[3] = Handler.cancel.selector;
        selectors[4] = Handler.recall.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
        excludeContract(address(registry));
    }

    function invariant_recalledStaysRecalled() public view {
        uint256 count = handler.batchCount();
        for (uint256 i = 0; i < count; ++i) {
            bytes32 id = handler.batchIds(i);
            if (handler.wasRecalled(id)) {
                ProductRegistry.Batch memory batch = registry.getBatch(id);
                assertEq(uint256(batch.status), uint256(ProductRegistry.Status.Recalled));
            }
        }
    }

    function invariant_manufacturerNeverChanges() public view {
        uint256 count = handler.batchCount();
        for (uint256 i = 0; i < count; ++i) {
            bytes32 id = handler.batchIds(i);
            assertEq(registry.getBatch(id).manufacturer, handler.expectedManufacturer(id));
        }
    }

    function invariant_custodianChangesOnlyOnAccept() public view {
        uint256 count = handler.batchCount();
        for (uint256 i = 0; i < count; ++i) {
            bytes32 id = handler.batchIds(i);
            assertEq(registry.getBatch(id).currentCustodian, handler.expectedCustodian(id));
        }
    }

    function invariant_historyMatchesAccepts() public view {
        uint256 count = handler.batchCount();
        for (uint256 i = 0; i < count; ++i) {
            bytes32 id = handler.batchIds(i);
            assertEq(registry.getCustodyHistory(id).length, handler.acceptCount(id));
        }
    }

    function invariant_existingActorsAreNonZero() public view {
        uint256 count = handler.batchCount();
        for (uint256 i = 0; i < count; ++i) {
            bytes32 id = handler.batchIds(i);
            ProductRegistry.Batch memory batch = registry.getBatch(id);
            assertTrue(batch.manufacturer != address(0));
            assertTrue(batch.currentCustodian != address(0));
        }
    }

    function invariant_pendingMatchesCustodian() public view {
        uint256 count = handler.batchCount();
        for (uint256 i = 0; i < count; ++i) {
            bytes32 id = handler.batchIds(i);
            ProductRegistry.Batch memory batch = registry.getBatch(id);
            ProductRegistry.PendingTransfer memory pending = registry.getPendingTransfer(id);
            if (!pending.active) continue;
            assertEq(uint256(batch.status), uint256(ProductRegistry.Status.Active));
            assertEq(pending.from, batch.currentCustodian);
            assertTrue(pending.to != address(0));
            assertTrue(pending.to != batch.currentCustodian);
        }
    }
}
