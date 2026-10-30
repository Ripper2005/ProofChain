CREATE TABLE indexer_meta (
  singleton boolean PRIMARY KEY DEFAULT TRUE,
  chain_id bigint NOT NULL,
  contract_address text NOT NULL,
  start_block bigint NOT NULL,
  start_block_hash text NOT NULL,
  last_processed_block bigint,
  last_processed_hash text,
  CONSTRAINT indexer_meta_one_row CHECK (singleton)
);

CREATE TABLE blocks (
  number bigint PRIMARY KEY,
  hash text NOT NULL,
  parent_hash text NOT NULL
);

CREATE TABLE logs (
  block_number bigint NOT NULL,
  block_hash text NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  event_name text NOT NULL,
  payload jsonb NOT NULL,
  applied boolean NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE INDEX logs_order_idx ON logs (block_number, log_index);

CREATE TABLE batches (
  batch_id text PRIMARY KEY,
  batch_code text NOT NULL UNIQUE,
  manufacturer text NOT NULL,
  current_custodian text NOT NULL,
  metadata_hash text NOT NULL,
  metadata_cid text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  created_block bigint NOT NULL,
  created_tx text NOT NULL,
  recalled_at timestamptz,
  recalled_block bigint,
  recalled_tx text,
  recall_pending_cleared boolean,
  recall_reason text,
  CONSTRAINT batches_status_check CHECK (status IN ('active', 'recalled'))
);

CREATE TABLE pending_transfers (
  batch_id text PRIMARY KEY REFERENCES batches (batch_id),
  from_address text NOT NULL,
  to_address text NOT NULL,
  proposed_at timestamptz NOT NULL,
  proposed_block bigint NOT NULL,
  proposed_tx text NOT NULL
);

CREATE TABLE custody_transfers (
  batch_id text NOT NULL REFERENCES batches (batch_id),
  from_address text NOT NULL,
  to_address text NOT NULL,
  accepted_at timestamptz NOT NULL,
  block_number bigint NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE INDEX custody_transfers_batch_idx ON custody_transfers (batch_id, block_number, log_index);
