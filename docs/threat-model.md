# Threat model

ProofChain is a shared custody log for a product batch. Ethereum records who registered it, who accepted each handoff, and whether it was recalled. Anyone can check that shared record without trusting one company's database. Confirmed history is tamper-evident under normal Ethereum assumptions. The administrator, the pinned files, and the website are separate trust points.

The chain records claims. It shows what was submitted and which wallet signed it. A manufacturer can register a false description. The chain then preserves that false claim and attributes it. Physical inspection and real identity processes sit outside the system. The chain does not prove the physical goods are genuine.

The protocol is [MASTER_PLAN.md](../MASTER_PLAN.md). The Foundry tests are the executable specification. This file is the trust write-up.

## What an external account can try

An external account has no manufacturer role, no recall role, and is not the current custodian or the named recipient.

`registerBatch` uses `onlyRole(MANUFACTURER_ROLE)` before the function body. An unauthorized caller gets `AccessControlUnauthorizedAccount` even when the batch code is already taken.

For propose, cancel, and accept, the contract checks in this order:

1. `BatchNotFound` when the batch does not exist.
2. `AlreadyRecalled` when the status is not active.
3. The custodian, recipient, and pending checks for that function.

A stranger proposing or cancelling an active batch is stopped by `NotCurrentCustodian`. A stranger accepting a pending handoff is stopped by `NotPendingRecipient`. Accepting or cancelling when nothing is pending is `NoPendingTransfer`. A second proposal, from anyone, is `TransferAlreadyPending` until the current one is accepted or cancelled.

`recallBatch` does not use `onlyRole`. It checks existence, then status, then the recall role. A stranger recalling an active batch sees `AccessControlUnauthorizedAccount`. A stranger proposing, accepting, cancelling, or recalling a recalled batch sees `AlreadyRecalled`, because the status is public through `getBatch` anyway. A stranger recalling an unknown batch sees `BatchNotFound`.

The custody page lets any connected wallet submit a proposal so an unauthorized account can be shown failing. The recall page warns when the connected wallet lacks the role, and it still surfaces the contract revert if they submit. A disabled button is not a substitute for that revert.

## What the administrator can do

The administrator is a trust point. The admin grants and revokes `MANUFACTURER_ROLE` and `RECALL_ROLE`. The interesting claim is that ordinary participants cannot bypass handoff rules or rewrite confirmed history. It is not that nobody has a privileged role.

That key can grant a manufacturer who then registers a false document. The chain preserves the false claim and attributes it to the wallet that signed `registerBatch`. The company name in the form is a claim inside the product document. The manufacturer the contract recognizes is the wallet that signed the registration.

A multisig or a delayed admin transfer is future work. This version keeps OpenZeppelin `AccessControl` and a single admin.

Account A holding both the manufacturer role and the recall role is a demo convenience. The contract and the tests treat manufacturer and recall as different roles.

## What the current custodian can do

The current custodian can propose a handoff to a wallet address, including an address that never accepts. The batch stays active. Pending is a flag on an active batch, not a third lifecycle status. Another proposal reverts with `TransferAlreadyPending` until this one is accepted or cancelled.

The current custodian can cancel that proposal. Cancel is stopped for everyone else by `NotCurrentCustodian`, after the existence and status checks. Only the named recipient can accept. On acceptance the contract updates the current custodian and appends the handoff to on-chain history.

Registration does not invent a previous custodian. On-chain history lists accepted handoffs only. Origin is the manufacturer address plus `createdAt`.

A zero recipient and a self-handoff revert with `InvalidRecipient`.

## What IPFS pinning loss looks like to a reader

IPFS availability is a trust and operations point. The CID and the hash let a reader detect a swapped or missing document. They do not keep the file online by themselves. The pin service must pin the bytes. The demo gateway must be reachable from the phone.

When the document fetch fails, the page still shows the on-chain custody, status, hashes, and transactions, and it shows the product document as unavailable. It does not invent the missing document. Unavailable is the failure a reader sees when the gateway cannot be reached. An image or certificate that fails to load does not by itself fail the document hash. Only the canonical JSON bytes are the commitment.

The pin routes are an operator endpoint. They are reached through the dev proxy or localhost. They are not a public pinning product. The only size controls are 64 KiB for the canonical document and 5 MB for the optional file.

## What a copied QR label does and does not prove

A QR code is a pointer, not a seal on the object. Someone can copy the label onto a different box. The copied QR still opens the same record: the same chain id, contract address, and batch code. This version identifies a batch or package. It does not cryptographically bind each electronic component. Copying the sticker onto another box is possible. ProofChain checks the recorded story and which wallet signed it.

The QR payload is the verification URL. The image is generated in the browser after a successful registration receipt. It is not stored on Ethereum, on IPFS, or in PostgreSQL.

## A hash and a CID that do not point at the same bytes

Both the hash and the CID are stored. The CID locates the bytes and is itself a content hash. `metadataHash` is `keccak256` of the canonical UTF-8 document, so the integrity rule is defined in this repository and can be checked with Ethereum tooling. Verification uses both.

The contract stores both and does not retrieve the file. A manufacturer can register a hash and a CID that do not point at the same bytes. That mismatched CID is a stored claim. Verification is where the disagreement becomes visible. The page shows mismatch when the fetch succeeds and any of the document checks fail: the keccak of the fetched bytes, the canonical form, the batch code inside the document, or the batch id. A mismatch is a finding, not an application crash. The green seal requires a trusted deployment and a match.

## What the indexer can get wrong

The website and PostgreSQL are conveniences. An auditor can ignore both and recompute the batch from the contract and its logs. If the indexer and the contract disagree, the contract is the record the demo defends.

The indexer can be down, behind the chain head, or wrong during a reorg. Reorgs are real on a public network. The indexer rewinds and replays. The contract does not implement its own reorg logic. Confirmation depth is an indexer setting: `CONFIRMATIONS` defaults to 0, and to 2 when the chain id is `11155111`.

The public verification page reads Ethereum and IPFS even when the indexer is down. It does not read PostgreSQL. Dashboard lists say they are unavailable when the indexer is behind or down. Direct actions still work. Roles on the dashboard are read with `hasRole` on the contract. They are not read from PostgreSQL.

## Pending handoffs and the supplier graph

Proposals are public before acceptance. Anyone can read a pending handoff. Only the named recipient can accept it. The same public record reveals who holds which batches and how often they move. That supplier graph is part of this version.

## Batch codes are a global namespace

Batch codes are a single global namespace. The first successful registration owns `PCB-2026-001`. Another manufacturer cannot register that same code. An unused code can be registered by whoever holds the manufacturer role first. The id stays `keccak256` of the code so a QR can name the batch without also naming a wallet. Squatting is a known property of this version, not a second id scheme.

Batch codes are case-sensitive. `PCB-2026-001` and `pcb-2026-001` are different batches. The UI preserves the typed case.

## One admin key

One admin key is a weak point. That key can appoint a manufacturer, and that manufacturer can write a false document. This version does not add a multisig or a delayed admin transfer.

## A lookalike contract

A green seal applies only to a trusted deployment. Anyone can deploy a lookalike contract and print a QR for it. The hash can match that lookalike's own storage. The page shows the green seal only when the chain id and contract address are in `trusted-deployments.json`. An unrecognized contract still shows the raw reads, with a hard warning and no green seal.

The contract is not upgradeable. A wrong rule is fixed by deploying a new contract. Old QR links include the contract address, so they keep pointing at the contract they were printed for. The trusted-deployment list can contain every deployment, current and earlier. One environment variable is not enough, because a single address would make older labels unverifiable. A recognized earlier deployment shows the data and says it is an earlier contract, with the current address beside it.

Metadata is not edited in place. There is no update function. A correction is a new batch and, when appropriate, a recall of the old one. Confirmed registrations stay in the history.

## The LAN reader

The page's reader is not the chain. A phone on the LAN reads through the laptop's `/rpc` proxy. The page says so and gives a `cast call` the audience can run against a node they choose. That `cast call`, and on chain id `11155111` the block explorer links, are the independent path.

Sepolia is not deployed, so the explorer links have not been exercised. The LAN demo is the one that has been exercised, and on that demo the independent check is the `cast call` against a node the reader chooses. The Anvil node on this computer is `http://127.0.0.1:8545`.

`/rpc` is a read-only allowlist. It rejects `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_sign`, `personal_*`, and `anvil_*`. A JSON-RPC batch that mixes an allowed call with a disallowed call is rejected in full. There is no WebSocket proxy on `/rpc`. A tunnel does not become a way to send Anvil transactions.

## Custody history is unbounded

Custody history is unbounded in this version. The demo has two hops. A long ping-pong between two custodians can grow the on-chain array. This version does not add a cap.

## Who pays gas

The wallet that submits the transaction pays the gas. This demo uses test ETH, not mainnet funds. On the local stack that test ETH is Anvil's development balance. Sepolia is not deployed, and this repository does not contain a funded testnet key.

## What the page shows when a call fails

A submitted transaction is not a registration. The QR appears after a successful receipt. If the receipt status is not success, the action fails with "The transaction reverted. The contract did not apply this action." The registration page shows that failure and does not offer a QR. A pin that already happened stays on IPFS.

An RPC error is a failure. The verification page shows "The site reader did not respond." It does not show the batch as found.

An unreachable gateway is a failure of the document fetch. The page shows the product document as unavailable and still shows custody, status, hashes, and transactions from the contract.

Those three cases are covered by `apps/web/test/failures.test.ts`. The verification rules are unchanged: match, mismatch, and unavailable stay as the document results, and the green seal still requires a trusted deployment and a match.

Confidential data does not go on the public chain. Names in the demo document are product and company claims the user chose to publish. Do not put personal data, secrets, or private commercial documents on-chain. A hash does not make the underlying document private once the document is on IPFS.

## Slither

Slither 0.11.6 was installed with `uv` into a Python 3.12 environment and run from `contracts/` on 30 October 2026:

```sh
slither . --filter-paths lib
```

Foundry compiled the project. Slither's human summary reported one source contract, `ProductRegistry`, 205 source lines, five dependency contracts, 104 dependency lines, and zero assembly lines. It reported zero optimization issues, zero informational issues, zero low issues, zero medium issues, and zero high issues.

There is no Slither finding to accept. The limits in this file, including the single admin key, the unbounded custody history, and the lack of a reentrancy guard, are properties of this version. The contract has no external calls, so it does not use a reentrancy guard. Slither did not flag them, and they remain accepted limits rather than tool findings. A run that cannot install the tool would be a gap. This run completed. The Foundry tests remain the executable specification.

## What is not in place

The LAN demo is the one that has been exercised. A demo that survives the laptop leaving needs hosted files, a keyless public RPC, and pins a public gateway can fetch. None of those are done. `rpcUrl` in `trusted-deployments.json` is empty. Sepolia is not deployed. Local Kubo pins are not a public gateway.
