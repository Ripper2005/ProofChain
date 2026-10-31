// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ProductRegistry} from "../src/ProductRegistry.sol";

contract Handler is Test {
    struct Expected {
        bool registered;
        bool recalled;
        address manufacturer;
        address custodian;
        bytes32 metadataHash;
        string metadataCid;
        bool pending;
        address pendingFrom;
        address pendingTo;
    }

    ProductRegistry public immutable registry;
    address public immutable manufacturer;
    address public immutable recaller;
    address public immutable stranger;

    address[] internal actors;
    address[] internal recipients;
    string[] internal codes;
    bytes32[] public batchIds;
    mapping(bytes32 id => Expected expected) internal model;
    mapping(bytes32 id => ProductRegistry.CustodyRecord[] history) internal modelHistory;

    uint256 public successes;
    uint256 public expectedReverts;

    string internal constant INVALID_CODE = "bad code";
    string internal constant CID = "bafkreicjx37puhth4lglmhqqna5gjrcvjedfpputssey6isdy5slgiz7im";
    string internal constant OTHER_CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

    constructor(
        ProductRegistry registry_,
        address manufacturer_,
        address recaller_,
        address alice,
        address bob,
        address stranger_
    ) {
        registry = registry_;
        manufacturer = manufacturer_;
        recaller = recaller_;
        stranger = stranger_;

        actors.push(manufacturer_);
        actors.push(recaller_);
        actors.push(alice);
        actors.push(bob);
        actors.push(stranger_);

        recipients.push(manufacturer_);
        recipients.push(recaller_);
        recipients.push(alice);
        recipients.push(bob);
        recipients.push(address(0));

        codes.push("B1");
        codes.push("B2");
        codes.push("B3");
        codes.push("B4");
    }

    function register(uint256 actorSeed, uint256 codeSeed, uint256 documentSeed, uint256 cidSeed) external {
        address caller = _actor(actorSeed, manufacturer);
        bool validCode = codeSeed % 5 != 4;
        string memory code = validCode ? codes[codeSeed % codes.length] : INVALID_CODE;
        string memory document = _document(documentSeed);
        string memory cid = _cid(cidSeed);
        bytes32 id = keccak256(bytes(code));
        uint256 documentLength = bytes(document).length;

        bytes memory expected;
        if (!registry.hasRole(registry.MANUFACTURER_ROLE(), caller)) {
            expected = _roleError(caller, registry.MANUFACTURER_ROLE());
        } else if (!validCode) {
            expected = abi.encodeWithSelector(ProductRegistry.InvalidBatchCode.selector);
        } else if (model[id].registered) {
            expected = abi.encodeWithSelector(ProductRegistry.BatchAlreadyExists.selector, id);
        } else if (documentLength == 0 || documentLength > registry.MAX_DOCUMENT_LENGTH() || !_validCid(cid)) {
            expected = abi.encodeWithSelector(ProductRegistry.InvalidMetadata.selector);
        }

        vm.prank(caller);
        try registry.registerBatch(code, document, cid) {
            _succeeded(expected);
            Expected storage batch = model[id];
            batch.registered = true;
            batch.manufacturer = caller;
            batch.custodian = caller;
            batch.metadataHash = keccak256(bytes(document));
            batch.metadataCid = cid;
            batchIds.push(id);
        } catch (bytes memory reason) {
            _reverted(reason, expected);
        }
    }

    function propose(uint256 actorSeed, uint256 batchSeed, uint256 recipientSeed) external {
        bytes32 id = _batch(batchSeed);
        Expected storage batch = model[id];
        address caller = _actor(actorSeed, batch.custodian);
        address to = recipients[recipientSeed % recipients.length];

        bytes memory expected = _custodianChecks(id, caller);
        if (expected.length == 0) {
            if (batch.pending) {
                expected = abi.encodeWithSelector(ProductRegistry.TransferAlreadyPending.selector, id);
            } else if (to == address(0) || to == batch.custodian) {
                expected = abi.encodeWithSelector(ProductRegistry.InvalidRecipient.selector, to);
            }
        }

        vm.prank(caller);
        try registry.proposeCustodyTransfer(id, to) {
            _succeeded(expected);
            batch.pending = true;
            batch.pendingFrom = caller;
            batch.pendingTo = to;
        } catch (bytes memory reason) {
            _reverted(reason, expected);
        }
    }

    function cancel(uint256 actorSeed, uint256 batchSeed) external {
        bytes32 id = _batch(batchSeed);
        Expected storage batch = model[id];
        address caller = _actor(actorSeed, batch.custodian);

        bytes memory expected = _custodianChecks(id, caller);
        if (expected.length == 0 && !batch.pending) {
            expected = abi.encodeWithSelector(ProductRegistry.NoPendingTransfer.selector, id);
        }

        vm.prank(caller);
        try registry.cancelCustodyTransfer(id) {
            _succeeded(expected);
            _clearPending(batch);
        } catch (bytes memory reason) {
            _reverted(reason, expected);
        }
    }

    function accept(uint256 actorSeed, uint256 batchSeed) external {
        bytes32 id = _batch(batchSeed);
        Expected storage batch = model[id];
        address caller = _actor(actorSeed, batch.pendingTo);

        bytes memory expected = _lifecycleChecks(id);
        if (expected.length == 0) {
            if (!batch.pending) {
                expected = abi.encodeWithSelector(ProductRegistry.NoPendingTransfer.selector, id);
            } else if (caller != batch.pendingTo) {
                expected = abi.encodeWithSelector(ProductRegistry.NotPendingRecipient.selector, caller, batch.pendingTo);
            }
        }

        vm.prank(caller);
        try registry.acceptCustodyTransfer(id) {
            _succeeded(expected);
            modelHistory[id].push(
                ProductRegistry.CustodyRecord({
                    from: batch.pendingFrom, to: batch.pendingTo, timestamp: uint64(block.timestamp)
                })
            );
            batch.custodian = batch.pendingTo;
            _clearPending(batch);
        } catch (bytes memory reason) {
            _reverted(reason, expected);
        }
    }

    function recall(uint256 actorSeed, uint256 batchSeed, uint256 reasonSeed) external {
        bytes32 id = _batch(batchSeed);
        Expected storage batch = model[id];
        address caller = _actor(actorSeed, recaller);
        string memory reason = _reason(reasonSeed);

        bytes memory expected = _lifecycleChecks(id);
        if (expected.length == 0) {
            if (!registry.hasRole(registry.RECALL_ROLE(), caller)) {
                expected = _roleError(caller, registry.RECALL_ROLE());
            } else if (bytes(reason).length > registry.MAX_REASON_LENGTH()) {
                expected = abi.encodeWithSelector(ProductRegistry.InvalidReason.selector);
            }
        }

        vm.prank(caller);
        try registry.recallBatch(id, reason) {
            _succeeded(expected);
            batch.recalled = true;
            _clearPending(batch);
        } catch (bytes memory revertData) {
            _reverted(revertData, expected);
        }
    }

    function batchCount() external view returns (uint256) {
        return batchIds.length;
    }

    function expectedOf(bytes32 id) external view returns (Expected memory) {
        return model[id];
    }

    function historyOf(bytes32 id) external view returns (ProductRegistry.CustodyRecord[] memory) {
        return modelHistory[id];
    }

    function _custodianChecks(bytes32 id, address caller) internal view returns (bytes memory) {
        bytes memory lifecycle = _lifecycleChecks(id);
        if (lifecycle.length != 0) return lifecycle;
        address custodian = model[id].custodian;
        if (caller != custodian) {
            return abi.encodeWithSelector(ProductRegistry.NotCurrentCustodian.selector, caller, custodian);
        }
        return "";
    }

    function _lifecycleChecks(bytes32 id) internal view returns (bytes memory) {
        if (!model[id].registered) return abi.encodeWithSelector(ProductRegistry.BatchNotFound.selector, id);
        if (model[id].recalled) return abi.encodeWithSelector(ProductRegistry.AlreadyRecalled.selector, id);
        return "";
    }

    function _succeeded(bytes memory expected) internal {
        assertEq(expected.length, 0, "the call succeeded where the model expected a revert");
        successes += 1;
    }

    function _reverted(bytes memory reason, bytes memory expected) internal {
        assertEq(reason, expected, "the call reverted with an error the model did not expect");
        expectedReverts += 1;
    }

    function _clearPending(Expected storage batch) internal {
        batch.pending = false;
        batch.pendingFrom = address(0);
        batch.pendingTo = address(0);
    }

    function _actor(uint256 seed, address natural) internal view returns (address) {
        if (natural != address(0) && seed % 2 == 0) return natural;
        return actors[(seed / 2) % actors.length];
    }

    function _batch(uint256 seed) internal view returns (bytes32) {
        if (batchIds.length > 0 && seed % 4 != 0) return batchIds[(seed / 4) % batchIds.length];
        return keccak256(bytes(codes[(seed / 4) % codes.length]));
    }

    function _document(uint256 seed) internal pure returns (string memory) {
        uint256 pick = seed % 8;
        if (pick == 0) return "";
        if (pick == 1) return string(new bytes(4097));
        if (pick == 2) return string(new bytes(4096));
        return string.concat("document-", vm.toString(seed));
    }

    function _cid(uint256 seed) internal pure returns (string memory) {
        uint256 pick = seed % 8;
        if (pick == 0) return "";
        if (pick == 1) return "bad cid";
        return pick % 2 == 0 ? CID : OTHER_CID;
    }

    function _validCid(string memory cid) internal pure returns (bool) {
        return keccak256(bytes(cid)) == keccak256(bytes(CID)) || keccak256(bytes(cid)) == keccak256(bytes(OTHER_CID));
    }

    function _reason(uint256 seed) internal pure returns (string memory) {
        uint256 pick = seed % 3;
        if (pick == 0) return "";
        if (pick == 1) return "Damaged seal";
        return string(new bytes(129));
    }

    function _roleError(address account, bytes32 role) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, account, role);
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

        handler =
            new Handler(registry, manufacturer, recaller, makeAddr("alice"), makeAddr("bob"), makeAddr("stranger"));

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
            ProductRegistry.Status expected =
                handler.expectedOf(id).recalled ? ProductRegistry.Status.Recalled : ProductRegistry.Status.Active;
            assertEq(uint256(registry.getBatch(id).status), uint256(expected));
        }
    }

    function invariant_manufacturerNeverChanges() public view {
        uint256 count = handler.batchCount();
        for (uint256 i = 0; i < count; ++i) {
            bytes32 id = handler.batchIds(i);
            assertEq(registry.getBatch(id).manufacturer, handler.expectedOf(id).manufacturer);
        }
    }

    function invariant_commitmentNeverChanges() public view {
        uint256 count = handler.batchCount();
        for (uint256 i = 0; i < count; ++i) {
            bytes32 id = handler.batchIds(i);
            ProductRegistry.Batch memory batch = registry.getBatch(id);
            Handler.Expected memory expected = handler.expectedOf(id);
            assertEq(batch.metadataHash, expected.metadataHash);
            assertEq(batch.metadataCid, expected.metadataCid);
        }
    }

    function invariant_existingActorsAreNonZero() public view {
        uint256 count = handler.batchCount();
        for (uint256 i = 0; i < count; ++i) {
            ProductRegistry.Batch memory batch = registry.getBatch(handler.batchIds(i));
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
            assertEq(pending.active, handler.expectedOf(id).pending);
            if (!pending.active) {
                assertEq(pending.from, address(0));
                assertEq(pending.to, address(0));
                assertEq(pending.proposedAt, 0);
                continue;
            }
            assertEq(uint256(batch.status), uint256(ProductRegistry.Status.Active));
            assertEq(pending.from, batch.currentCustodian);
            assertTrue(pending.to != address(0));
            assertTrue(pending.to != batch.currentCustodian);
        }
    }

    function invariant_historyGrowsOnlyOnAccept() public view {
        uint256 count = handler.batchCount();
        for (uint256 i = 0; i < count; ++i) {
            bytes32 id = handler.batchIds(i);
            ProductRegistry.CustodyRecord[] memory actual = registry.getCustodyHistory(id);
            ProductRegistry.CustodyRecord[] memory expected = handler.historyOf(id);
            assertEq(actual.length, expected.length);
            for (uint256 j = 0; j < actual.length; ++j) {
                assertEq(actual[j].from, expected[j].from);
                assertEq(actual[j].to, expected[j].to);
                assertEq(actual[j].timestamp, expected[j].timestamp);
            }
        }
    }

    function invariant_custodianChangesOnlyOnAccept() public view {
        uint256 count = handler.batchCount();
        for (uint256 i = 0; i < count; ++i) {
            bytes32 id = handler.batchIds(i);
            assertEq(registry.getBatch(id).currentCustodian, handler.expectedOf(id).custodian);
        }
    }
}
