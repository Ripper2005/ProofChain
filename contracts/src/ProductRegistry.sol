// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ProductRegistry
/// @notice Shared custody log for a product batch. The contract stores claims and who signed them.
contract ProductRegistry is AccessControl {
    bytes32 public constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");
    bytes32 public constant RECALL_ROLE = keccak256("RECALL_ROLE");

    uint256 public constant MAX_BATCH_CODE_LENGTH = 64;
    uint256 public constant MAX_DOCUMENT_LENGTH = 4096;
    uint256 public constant MAX_CID_LENGTH = 128;
    uint256 public constant MAX_REASON_LENGTH = 128;

    enum Status {
        None,
        Active,
        Recalled
    }

    struct Batch {
        string batchCode;
        address manufacturer;
        address currentCustodian;
        bytes32 metadataHash;
        string metadataCid;
        Status status;
        uint64 createdAt;
    }

    struct PendingTransfer {
        address from;
        address to;
        uint64 proposedAt;
        bool active;
    }

    struct CustodyRecord {
        address from;
        address to;
        uint64 timestamp;
    }

    mapping(bytes32 batchId => Batch batch) private _batches;
    mapping(bytes32 batchId => PendingTransfer pending) private _pending;
    mapping(bytes32 batchId => CustodyRecord[] history) private _history;

    event BatchRegistered(
        bytes32 indexed batchId,
        address indexed manufacturer,
        string batchCode,
        bytes32 metadataHash,
        string metadataCid,
        uint64 createdAt,
        string document
    );

    event CustodyTransferProposed(bytes32 indexed batchId, address indexed from, address indexed to, uint64 proposedAt);

    event CustodyTransferCancelled(
        bytes32 indexed batchId, address indexed from, address indexed to, uint64 cancelledAt
    );

    event CustodyTransferred(bytes32 indexed batchId, address indexed from, address indexed to, uint64 timestamp);

    event BatchRecalled(
        bytes32 indexed batchId, address indexed recalledBy, bool pendingCleared, uint64 recalledAt, string reason
    );

    error ZeroAddress();
    error InvalidBatchCode();
    error BatchAlreadyExists(bytes32 batchId);
    error BatchNotFound(bytes32 batchId);
    error InvalidMetadata();
    error InvalidRecipient(address to);
    error TransferAlreadyPending(bytes32 batchId);
    error NoPendingTransfer(bytes32 batchId);
    error NotCurrentCustodian(address caller, address custodian);
    error NotPendingRecipient(address caller, address recipient);
    error AlreadyRecalled(bytes32 batchId);
    error InvalidReason();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function computeBatchId(string calldata batchCode) external pure returns (bytes32) {
        _validateBatchCode(batchCode);
        return keccak256(bytes(batchCode));
    }

    function registerBatch(string calldata batchCode, string calldata document, string calldata metadataCid)
        external
        onlyRole(MANUFACTURER_ROLE)
    {
        _validateBatchCode(batchCode);
        bytes32 batchId = keccak256(bytes(batchCode));
        if (_batches[batchId].status != Status.None) revert BatchAlreadyExists(batchId);
        _validateDocument(document);
        _validateCid(metadataCid);

        bytes32 metadataHash = keccak256(bytes(document));
        _batches[batchId] = Batch({
            batchCode: batchCode,
            manufacturer: msg.sender,
            currentCustodian: msg.sender,
            metadataHash: metadataHash,
            metadataCid: metadataCid,
            status: Status.Active,
            // forge-lint: disable-next-line(unsafe-typecast)
            createdAt: uint64(block.timestamp)
        });

        // forge-lint: disable-next-item(unsafe-typecast)
        emit BatchRegistered(
            batchId, msg.sender, batchCode, metadataHash, metadataCid, uint64(block.timestamp), document
        );
    }

    function proposeCustodyTransfer(bytes32 batchId, address to) external {
        Batch storage batch = _existingBatch(batchId);
        _requireActive(batch, batchId);
        if (msg.sender != batch.currentCustodian) revert NotCurrentCustodian(msg.sender, batch.currentCustodian);

        PendingTransfer storage pending = _pending[batchId];
        if (pending.active) revert TransferAlreadyPending(batchId);
        if (to == address(0) || to == batch.currentCustodian) revert InvalidRecipient(to);

        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 proposedAt = uint64(block.timestamp);
        pending.from = msg.sender;
        pending.to = to;
        pending.proposedAt = proposedAt;
        pending.active = true;

        emit CustodyTransferProposed(batchId, msg.sender, to, proposedAt);
    }

    function cancelCustodyTransfer(bytes32 batchId) external {
        Batch storage batch = _existingBatch(batchId);
        _requireActive(batch, batchId);
        if (msg.sender != batch.currentCustodian) revert NotCurrentCustodian(msg.sender, batch.currentCustodian);

        PendingTransfer storage pending = _pending[batchId];
        if (!pending.active) revert NoPendingTransfer(batchId);
        if (pending.from != batch.currentCustodian) revert NotCurrentCustodian(msg.sender, batch.currentCustodian);

        address from = pending.from;
        address to = pending.to;
        _clearPending(batchId);

        // forge-lint: disable-next-line(unsafe-typecast)
        emit CustodyTransferCancelled(batchId, from, to, uint64(block.timestamp));
    }

    function acceptCustodyTransfer(bytes32 batchId) external {
        Batch storage batch = _existingBatch(batchId);
        _requireActive(batch, batchId);

        PendingTransfer storage pending = _pending[batchId];
        if (!pending.active) revert NoPendingTransfer(batchId);
        if (msg.sender != pending.to) revert NotPendingRecipient(msg.sender, pending.to);

        address from = pending.from;
        address to = pending.to;
        batch.currentCustodian = to;
        _clearPending(batchId);

        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 timestamp = uint64(block.timestamp);
        _history[batchId].push(CustodyRecord({from: from, to: to, timestamp: timestamp}));

        emit CustodyTransferred(batchId, from, to, timestamp);
    }

    function recallBatch(bytes32 batchId, string calldata reason) external {
        Batch storage batch = _existingBatch(batchId);
        _requireActive(batch, batchId);
        _checkRole(RECALL_ROLE, msg.sender);
        if (bytes(reason).length > MAX_REASON_LENGTH) revert InvalidReason();

        bool pendingCleared = _pending[batchId].active;
        if (pendingCleared) _clearPending(batchId);
        batch.status = Status.Recalled;

        // forge-lint: disable-next-line(unsafe-typecast)
        emit BatchRecalled(batchId, msg.sender, pendingCleared, uint64(block.timestamp), reason);
    }

    function getBatch(bytes32 batchId) external view returns (Batch memory) {
        return _existingBatch(batchId);
    }

    function getPendingTransfer(bytes32 batchId) external view returns (PendingTransfer memory) {
        _existingBatch(batchId);
        return _pending[batchId];
    }

    function getCustodyHistory(bytes32 batchId) external view returns (CustodyRecord[] memory) {
        _existingBatch(batchId);
        return _history[batchId];
    }

    function _existingBatch(bytes32 batchId) internal view returns (Batch storage batch) {
        batch = _batches[batchId];
        if (batch.status == Status.None) revert BatchNotFound(batchId);
    }

    function _requireActive(Batch storage batch, bytes32 batchId) internal view {
        if (batch.status != Status.Active) revert AlreadyRecalled(batchId);
    }

    function _clearPending(bytes32 batchId) internal {
        PendingTransfer storage pending = _pending[batchId];
        pending.from = address(0);
        pending.to = address(0);
        pending.proposedAt = 0;
        pending.active = false;
    }

    function _validateBatchCode(string calldata batchCode) internal pure {
        bytes memory raw = bytes(batchCode);
        if (raw.length < 1 || raw.length > MAX_BATCH_CODE_LENGTH) revert InvalidBatchCode();
        for (uint256 i = 0; i < raw.length; ++i) {
            bytes1 character = raw[i];
            bool digit = character >= 0x30 && character <= 0x39;
            bool upper = character >= 0x41 && character <= 0x5A;
            bool lower = character >= 0x61 && character <= 0x7A;
            bool hyphen = character == 0x2D;
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (!(digit || upper || lower || hyphen)) revert InvalidBatchCode();
        }
    }

    function _validateDocument(string calldata document) internal pure {
        uint256 length = bytes(document).length;
        if (length < 1 || length > MAX_DOCUMENT_LENGTH) revert InvalidMetadata();
    }

    function _validateCid(string calldata metadataCid) internal pure {
        bytes memory raw = bytes(metadataCid);
        if (raw.length < 1 || raw.length > MAX_CID_LENGTH) revert InvalidMetadata();
        for (uint256 i = 0; i < raw.length; ++i) {
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (raw[i] < 0x21 || raw[i] > 0x7E) revert InvalidMetadata();
        }
    }
}
