# ProofChain master plan

Status: packages 1 through 4 and the integration files are accepted. Package 5 is next. The private repository is https://github.com/Ripper2005/ProofChain.
Last updated: 30 October 2026.
The product is unchanged. Build quality is not tied to a calendar date. Every package in section 18 is finished to the spec, including the indexer, the threat model, Slither, CI, and an honest Sepolia path.
Repository root: `/home/harsha/Documents/Blockchain Project/`.
This file is the specification. If a chat, a brief, or another document disagrees with this file, this file wins until the planning chat changes it.

## 0. Bootstrap

Read this entire file before designing, implementing, or reviewing ProofChain.

Two kinds of sessions exist:

- **Planning session.** Owns the product, the architecture, the briefs, and the verification of executor work. It updates this file when a locked decision changes. It does not implement product code unless the user explicitly asks it to implement.
- **Executor session.** Implements one work package from section 18, or a brief that names one. It follows the locked decisions. It does not reopen them, widen the product, or edit this file.

The user builds the whole product end to end with these sessions. Course teammates are not implementers. Do not split work across teammates, do not write role assignments for them, and do not leave parts unfinished on the assumption that a person will fill them in.

Nothing in this repository has been implemented yet. This master plan is the first artifact.

Sections 1 through 17 are the product. Section 18 is the build order, and every package there stays in scope. Section 19 is a machine snapshot that goes stale. Keep this as one file so a new session can recover the whole project from it.

## 1. What ProofChain is

ProofChain is a shared custody log for a product batch, built on Ethereum.

A manufacturer registers one batch, such as a box of 50 boards, and pins a product document to IPFS. The Ethereum contract stores the batch code, the hash of that document, the IPFS content identifier, the current custodian, and whether the batch is active or recalled. Custody moves only when the current holder proposes a handoff and the named wallet accepts it. A recall role can freeze the batch. Anyone with the QR link can read the contract, fetch the document, and check that the document still matches the registered hash.

One sentence, for a professor or a demo:

> ProofChain is a shared custody log for a product batch: Ethereum records who registered it, who accepted each handoff, and whether it was recalled, and anyone can check that record without trusting one company's database.

About a minute:

A batch of components can pass through a manufacturer, a distributor, and a retailer, with each company keeping its own spreadsheet. When those records disagree, there is no common history to inspect. ProofChain puts the batch id, the metadata hash, the current custodian, and the recall status in an Ethereum contract. Custody moves only when the current holder proposes a transfer and the named recipient accepts it. A customer or auditor opens the batch, sees that sequence with transaction hashes, and checks that the product document still matches the registered hash. The contract rejects an unauthorized transfer. What it cannot do is prove the physical goods match the story that was signed.

Lead with that problem. Introduce Ethereum as the mechanism that makes the shared record and the handoff rules independently checkable.

### Words to use

Use these words in the interface, the README, and the demo.

| Say | Use it for |
| --- | --- |
| Custody | Which registered wallet currently holds the batch |
| Handoff | A proposed transfer that the named recipient must accept |
| Tamper-evident | Confirmed history that a participant cannot quietly rewrite |
| Shared record | The contract state and its logs |
| Commitment | The `keccak256` of the canonical product document |
| Batch | One package, such as a box of 50 boards. One QR per batch |

The company name in the form is a claim inside the product document. The manufacturer the contract recognizes is the wallet that signed `registerBatch`.

### Words that misstate the product

Avoid these in copy and in code comments that users or professors will see.

- **Ownership** and **legal title.** The contract records an operational handoff between wallets.
- **Decentralized** as the headline. Ethereum consensus is shared. An administrator still grants the manufacturer and recall roles.
- **Counterfeit detection.** The contract cannot tell that a physical object is genuine.
- **Immutable** without the hedge. Confirmed history is tamper-evident under normal Ethereum assumptions. The administrator, the pinned files, and the website are separate trust points, described in section 6.

## 2. The problem and the value

A product can pass through several companies. Origin, custody, and certificates often live in private databases, invoices, and spreadsheets. Those copies can disagree. A customer, auditor, or partner then has to trust whichever company is showing them a screen.

ProofChain gives those parties one record with three properties:

1. **Tamper-evident history.** After a transaction is confirmed, a participant cannot edit that history in a private database and have the chain accept the edit as the shared record.
2. **A reconstructable custody sequence.** The contract stores each accepted handoff. The logs carry the transaction hashes. A recall is part of the same record.
3. **Rules that one participant cannot bypass in the application server.** Only a manufacturer role can register. Only the current custodian can propose or cancel. Only the named recipient can accept. Only a recall role can recall.

A conventional site could show the same screens from a database. The Ethereum contract is what lets another organization check the rules and the history without treating one company's database as the authority.

| Conventional application | ProofChain |
| --- | --- |
| A central organization controls the authoritative database. | The shared record is the contract state, maintained by Ethereum consensus. |
| A database administrator may alter rows within their permissions. | Confirmed history is tamper-evident and costly to rewrite under normal network assumptions. |
| Other organizations trust the operator's procedures. | Another party can read the contract, the logs, and the document hash directly. |
| The server is the main place business rules are enforced. | Registration, handoff, and recall rules are enforced by the contract. |

A signed log or a consortium database can also show a history. Someone still has to keep that log available and complete. On public Ethereum, a reader who already trusts the chain's consensus can check the contract without joining a club of operators. The wallet that sends a transaction pays the gas. This demo uses test ETH, not mainnet funds.

## 3. What the product does

Illustrative batch used throughout the demo and the test vector:

| Field | Value |
| --- | --- |
| Product name | STM32 Controller Development Board |
| SKU | CTRL-STM32-A |
| Batch code | PCB-2026-001 |
| Quantity | 50 boards |
| Production date | 2026-10-15 |
| Manufacturer name in the document | Demo Electronics Pvt. Ltd. |

That batch is one registration and one QR code for the box. Individual boards inside the box are not registered separately.

### Registration

1. The manufacturer fills the form: name, SKU, batch code, quantity, production date, company name, and one optional image or certificate.
2. The app builds the canonical metadata document from section 10 and computes `metadataHash`.
3. If there is an optional file, the app uploads those exact bytes first and places the returned CID in `imageCid` before the document is hashed.
4. The app sends the canonical document to the pin service. The service checks the hash, pins those exact bytes to IPFS, and returns the CID and the hash.
5. The manufacturer's wallet calls `registerBatch` with that same batch code, hash, and CID. The contract checks the manufacturer role, rejects a duplicate batch code, and stores those values. It does not fetch IPFS, so it cannot prove the CID actually points at those bytes. A mismatched CID is a stored claim that verification shows as a mismatch.
6. The app waits for the transaction receipt. A transaction hash alone does not mean the batch exists. If the wallet rejects the prompt, or the receipt fails, any pin that already happened stays on IPFS and the UI does not offer a QR code.
7. After the receipt succeeds, the browser builds a QR image from the verification URL and offers a PNG download.

### Custody

1. The current custodian proposes a handoff to a wallet address.
2. The batch now has one pending handoff. Another proposal reverts until this one is accepted or cancelled.
3. The named recipient accepts. The contract updates the current custodian and appends the handoff to on-chain history.
4. The current custodian may cancel a pending handoff instead.

### Recall

A recall-role wallet recalls the batch. Any pending handoff is cleared. The status becomes recalled. Later propose, accept, and cancel calls revert. The same QR link shows the recalled status.

### Public verification

A phone opens the QR URL with no wallet. The page reads the contract and the logs, fetches the document, and compares the hash. PostgreSQL is not on this path. The document result is one of three successful page states: **match**, **mismatch**, or **unavailable**. A mismatch is a finding, not an application crash.

## 4. Live demo

The user drives every wallet. Use four browser accounts.

| Account | Roles in the solo demo | Actions |
| --- | --- | --- |
| A | `MANUFACTURER_ROLE` and `RECALL_ROLE` | Register the batch. Propose the first handoff. Recall at the end. |
| B | none | Accept custody from A. Propose the handoff to C. |
| C | none | Accept custody from B. |
| D | none | Attempt a handoff. The contract reverts. |

Tests still use separate addresses for manufacturer and recall, so the role split is proven even though account A holds both roles during the live demo.

Sequence:

1. Account A registers `PCB-2026-001`. After the receipt, download the QR.
2. Scan it on a phone. The page shows the document, the registration transaction, custodian A, and status active.
3. A proposes custody to B. B accepts. Refresh the phone. The history shows that handoff.
4. B proposes custody to C. C accepts. The phone shows both handoffs and C as the current custodian.
5. D tries to propose a transfer. The interface shows the contract revert. A disabled button is not a substitute for that revert.
6. A recalls the batch. The same QR now shows recalled.

The phone must be able to open the URL encoded in the QR. JavaScript runs on the device that opened the page, so an address of `localhost` or `127.0.0.1` inside that page means the phone, not the laptop.

The dev server listens on `0.0.0.0:5173` and proxies same-origin paths. The manufacturer uses `http://localhost:5173` for the wallet, because a LAN IP over HTTP is not a secure context. MetaMask's Anvil network points at `http://127.0.0.1:8545` directly. Wallet writes do not go through the proxy.

| Browser path | Rule |
| --- | --- |
| `/rpc` | Read-only allowlist: `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getBlockByHash`, `eth_getCode`, `eth_call`, `eth_getLogs`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBalance`, `eth_gasPrice`, `eth_estimateGas`, `net_version`, `web3_clientVersion`. A body may be one call or an array of calls. Every element must have an allowlisted `method`. If any element is missing or disallowed, reject the whole request. Do not enable WebSocket proxying on `/rpc`. Upgrades skip body inspection. Reject `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_sign`, `personal_*`, and `anvil_*`. |
| `/ipfs/{cid}` | Proxied to the Kubo gateway. |
| `/api` | GET is proxied to the indexer. POST is proxied to the pin service only when both checks pass: the TCP peer address is loopback (`127.0.0.1`, `::1`, or `::ffff:127.0.0.1`), and the `Host` header is `localhost` or `127.0.0.1`, with an optional port. Either check failing rejects the request. A forged `Host: localhost` from a LAN address fails the peer check. A tunnel whose peer is loopback fails the Host check. |

The registration screen has an editable QR origin, prefilled from `VITE_PUBLIC_ORIGIN` or, if that is empty, from `window.location.origin`. Changing the field regenerates the QR without restarting the dev server. A venue LAN address is typed there when the laptop joins the network. The localhost warning from section 11 still applies when the origin in the field is loopback.

A phone on the same network can then open the verification page, and that page reads the chain and the document through `/rpc` and `/ipfs`. Classroom Wi-Fi often isolates clients. The backup is a phone hotspot, or a tunnel with Vite `server.allowedHosts` set. The read-only RPC rule and the Host check stay on in both cases. A tunnel does not become a way to send Anvil transactions.

Sepolia, chain id `11155111`, is the public contract deployment. It does not by itself make the demo work after the laptop is gone. That requires a hosted copy of the static build, a public RPC, and document bytes that a public gateway can fetch. Bytes pinned only to a local Kubo node are not automatically on public gateways. The LAN demo is the one that must work first. Package 4 records both setups honestly.

Switching four wallet accounts is part of the demo. Do not add a browser connector that signs as Anvil's unlocked accounts. Fund a Sepolia account before the demo day, and keep a recorded backup of the full path.

If the document fetch fails, the page still shows the on-chain custody, status, hashes, and transactions, and it shows the product document as unavailable. It does not invent the missing document. An image or certificate that fails to load does not by itself fail the document hash. Only the canonical JSON bytes are the commitment.

Say this limitation out loud in the demo: copying the sticker onto another box is possible. ProofChain checks the recorded story and who signed it.

## 5. Screens

| Route | Who | What it does |
| --- | --- | --- |
| `/` | anyone | One-sentence explanation, wallet connection, and a batch-code lookup that opens the verification URL for the configured chain and contract. |
| `/register` | manufacturer wallet | The registration form, the receipt, then the QR download. |
| `/custody` | connected wallet | Propose, accept, and cancel. Any connected wallet can submit a propose so an unauthorized account can be shown failing. |
| `/recall` | connected wallet | Recall. Warn when the connected wallet lacks the role, and still surface the contract revert if they submit. |
| `/verify/:chainId/:contractAddress/:batchCode` | anyone, no wallet | Public verification. |

The dashboard information lives on `/`: connected address, network, roles held, batches related to that address, and pending handoffs. Those lists come from the indexer. The page shows the indexer's last processed block beside the chain head. Direct actions still work if the indexer is behind or down, and the lists say they are unavailable.

Visual direction: a verification instrument, not a token landing page. Light paper background, black text, monospace for addresses and hashes, one seal color used when a batch is recalled or a hash mismatches. No gradient hero, no price chart, no generic three-card feature row.

## 6. Nuances and trust assumptions

These are part of the product. Preserve them in the interface and the write-up.

1. **The chain records claims.** It shows what was submitted and which wallet signed it. A manufacturer can register a false description. The chain then preserves that false claim and attributes it. Physical inspection and real identity processes sit outside the system.
2. **A QR code is a pointer, not a seal on the object.** Someone can copy the label onto a different box. This version identifies a batch or package. It does not cryptographically bind each electronic component.
3. **The administrator is a trust point.** The admin grants and revokes `MANUFACTURER_ROLE` and `RECALL_ROLE`. The interesting claim is that ordinary participants cannot bypass handoff rules or rewrite confirmed history. It is not that nobody has a privileged role.
4. **The website and PostgreSQL are conveniences.** An auditor can ignore both and recompute the batch from the contract and its logs. If the indexer and the contract disagree, the contract is the record the demo defends.
5. **IPFS availability is a trust and operations point.** The CID and the hash let a reader detect a swapped or missing document. They do not keep the file online by themselves. The pin service must pin the bytes. The demo gateway must be reachable from the phone.
6. **Both the hash and the CID are stored.** The CID locates the bytes and is itself a content hash. `metadataHash` is `keccak256` of the canonical UTF-8 document, so the integrity rule is defined in this repository and can be checked with Ethereum tooling. Verification uses both.
7. **Metadata is not edited in place.** There is no update function. A correction is a new batch and, when appropriate, a recall of the old one. Confirmed registrations stay in the history.
8. **The contract is not upgradeable.** A wrong rule is fixed by deploying a new contract. Old QR links include the contract address, so they keep pointing at the contract they were printed for. The trusted-deployment list can contain every deployment, current and earlier. One environment variable is not enough, because a single address would make older labels unverifiable.
9. **Pending custody is not a third lifecycle status.** A batch is active or recalled. Pending is a flag on an active batch.
10. **Registration does not invent a previous custodian.** On-chain history lists accepted handoffs only. Origin is the manufacturer address plus `createdAt`.
11. **Confidential data does not go on the public chain.** Names in the demo document are product and company claims the user chose to publish. Do not put personal data, secrets, or private commercial documents on-chain. A hash does not make the underlying document private once the document is on IPFS.
12. **A submitted transaction is not a registration.** The QR appears after a successful receipt.
13. **Account A holding two roles is a demo convenience.** The contract and the tests treat manufacturer and recall as different roles.
14. **Reorgs are real on a public network.** The indexer rewinds and replays. The contract does not implement its own reorg logic. Confirmation depth is an indexer setting.
15. **The public verification page reads Ethereum and IPFS even when the indexer is down.** Roles on the dashboard are read with `hasRole` on the contract. They are not read from PostgreSQL.
16. **A registered CID can disagree with the registered hash.** The contract stores both and does not retrieve the file. Verification is where that disagreement becomes visible.
17. **Batch codes are case-sensitive.** `PCB-2026-001` and `pcb-2026-001` are different batches. The UI preserves the typed case.
18. **Custody history is unbounded in this version.** The demo has two hops. A long ping-pong between two custodians can grow the on-chain array. That limit belongs in the threat write-up. This version does not add a cap.
19. **The pin routes are an operator endpoint.** They are reached through the dev proxy or localhost. They are not a public pinning product. The only size controls are 64 KiB for the canonical document and 5 MB for the optional file.
20. **Proposals are public before acceptance.** Anyone can read a pending handoff. Only the named recipient can accept it. The same public record reveals who holds which batches and how often they move. That supplier graph is part of the threat write-up.
21. **Batch codes are a single global namespace.** The first successful registration owns `PCB-2026-001`. Another manufacturer cannot register that same code. An unused code can be registered by whoever holds the manufacturer role first. The id stays `keccak256` of the code so a QR can name the batch without also naming a wallet. Squatting is a known property of this version, not a second id scheme.
22. **One admin key is a weak point.** That key can grant a manufacturer who then writes a false document. A multisig or a delayed admin transfer is future work. This version keeps OpenZeppelin `AccessControl` and a single admin.
23. **A green seal applies only to a trusted deployment.** Anyone can deploy a lookalike contract and print a QR for it. The hash can match that lookalike's own storage. The page shows the green seal only when the chain id and contract address are in `trusted-deployments.json`. An unrecognized contract still shows the raw reads, with a hard warning and no green seal.
24. **The page's reader is not the chain.** A phone on the LAN reads through the laptop's `/rpc` proxy. The page says so and gives a `cast call` the audience can run against a node they choose. On Sepolia it also links the address and the transactions to the block explorer.

## 7. Architecture

```text
Laptop browser (wallet)
  writes through the injected wallet to 127.0.0.1:8545
  pins and searches through same-origin /api
        |
        v
Vite on the laptop, bound to 0.0.0.0:5173
  POST /api  -> pin :8788     only from a loopback peer and a localhost Host
  GET /api   -> indexer :8787
  /rpc       -> Ethereum JSON-RPC, read-only, no WebSocket
  /ipfs      -> Kubo gateway
        |
        +--> Kubo pins exact bytes
        +--> ProductRegistry stores the claim
        +--> Indexer projects logs into PostgreSQL

Phone browser, no wallet
  opens the QR origin
  reads /verify, /rpc, and /ipfs on that same origin
  does not call /api to decide what is true
```

| Piece | Authority? | Role |
| --- | --- | --- |
| `ProductRegistry` | Yes, for custody, status, roles, and the commitment | Shared rules and state |
| Ethereum logs | Yes, for transaction hashes and the audit sequence | Independent reconstruction |
| IPFS | Locator for the document | Holds the canonical JSON and the optional file |
| Pin service | No | Checks the hash, pins exact bytes, returns the CID |
| PostgreSQL indexer | No | Searchable projection. Deduplicates logs, survives restarts, rewinds reorgs |
| Web app | No | Wallet actions, QR generation, public verification |

Local development runs Anvil, Kubo, PostgreSQL, and the indexer. The web app runs on the host and is the only process the phone must reach. Wallet transactions from the laptop go to `127.0.0.1:8545`. The phone's chain reads go through the read-only `/rpc` proxy.

Who must reach what:

| Actor | Site | Chain reads | IPFS reads | Pin and indexer | Wallet writes |
| --- | --- | --- | --- | --- | --- |
| Manufacturer laptop | yes | yes | yes | yes | yes |
| Phone scanner | yes | yes, through `/rpc` | yes, through `/ipfs` | no | no |

## 8. Tech stack

| Layer | Choice |
| --- | --- |
| Contract | Solidity 0.8.24 or newer, Foundry, optimizer on |
| Access control | OpenZeppelin Contracts 5.x `AccessControl`. Do not invent a second role system |
| Web | React, TypeScript, Vite |
| Chain client | Viem and Wagmi. Do not add a second wallet library |
| App data | TanStack Query, React Router |
| QR | Generated in the browser from the verification URL. PNG download |
| Metadata package | TypeScript package shared by the web app and the pin service |
| Indexer and pin API | TypeScript on Node, Hono, `pg` |
| Database | PostgreSQL |
| Content storage | Kubo |
| Local chain | Anvil, chain id `31337`, port `8545` |
| Public demo chain | Sepolia, chain id `11155111` |
| Package manager | pnpm |
| Tests | Foundry for contracts. `node:test` for the metadata package and indexer |

Do not add NFTs, a token, a marketplace, upgrade proxies, or a custom consensus node.

## 9. Repository layout

The repository root is the workspace root. Do not wrap it in an extra `proofchain/` directory.

```text
MASTER_PLAN.md
README.md
package.json
pnpm-workspace.yaml
docker-compose.yml
.env.example
contracts/
  foundry.toml
  src/ProductRegistry.sol
  script/Deploy.s.sol
  test/ProductRegistry.t.sol
  test/ProductRegistryFuzz.t.sol
  test/ProductRegistryInvariant.t.sol
packages/metadata/
  src/
  test/
services/pin/
  src/
  test/
apps/web/
  src/
  trusted-deployments.json
indexer/
  src/
  test/
  migrations/
docs/threat-model.md
```

`README.md` tells a stranger how to run the local stack and the demo. `docs/threat-model.md` is the academic trust write-up taken from section 6. Neither file becomes a second protocol specification.

Work packages create these files. Do not create empty placeholders ahead of the package that owns them.

## 10. Metadata and hashing

### Canonical document

Required keys, always present:

| Key | Type | Rule |
| --- | --- | --- |
| `schemaVersion` | number | `1` |
| `name` | string | non-empty, trimmed |
| `sku` | string | non-empty, trimmed |
| `batchCode` | string | the same code passed to `registerBatch` |
| `quantity` | number | integer `>= 1` |
| `productionDate` | string | `YYYY-MM-DD` |
| `manufacturerName` | string | non-empty, trimmed |
| `description` | string | always present. Empty string when unused |
| `imageCid` | string | always present. Empty string when there is no file |

Canonical form:

- Recursively sort object keys by UTF-16 code units, which is JavaScript `Array.prototype.sort` with no comparator.
- Preserve array order. The v1 document has no arrays.
- Serialize with `JSON.stringify` and no extra whitespace.
- Reject `undefined`, functions, `bigint`, `Date`, `NaN`, and `Infinity` before serialization.
- The pinned bytes are the UTF-8 bytes of that exact string.
- `metadataHash = keccak256` of those bytes. In Viem this is `keccak256(toBytes(canonical))`. In Solidity the same ASCII and UTF-8 bytes are `keccak256(bytes(canonical))`.
- Unknown keys are rejected. A number typed as a string is rejected. `quantity` must be a JSON integer. `productionDate` must be a real calendar date in `YYYY-MM-DD`.
- The canonical document is at most 64 KiB.

The shared `packages/metadata` module is the only off-chain implementation of this rule and of batch ids. It exports `canonicalize`, `hashMetadata`, `computeBatchId`, `validateBatchCode`, and `parseAndValidate`. The web app and the pin service import it. They do not reimplement the hash or the id.

### Golden vector

Canonical string:

```text
{"batchCode":"PCB-2026-001","description":"","imageCid":"","manufacturerName":"Demo Electronics Pvt. Ltd.","name":"STM32 Controller Development Board","productionDate":"2026-10-15","quantity":50,"schemaVersion":1,"sku":"CTRL-STM32-A"}
```

Computed with Viem 2.57.13:

```text
batchId       0x9d6be2557c721891700c118158cc27ec51fd21cd40d2b73a7670b7e1466936d2
metadataHash  0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752
```

`batchId = keccak256` of the UTF-8 batch code `PCB-2026-001`. The metadata package tests must reproduce both values. Changing the key set, key order, or whitespace changes the vector on purpose.

### Pinning

`POST /blobs` accepts raw file bytes, up to 5 MB, and returns `{ "cid" }`. An empty body is rejected. The client puts that CID into `imageCid` before hashing the document.

`POST /metadata` accepts:

```json
{ "canonical": "<json string>", "batchCode": "PCB-2026-001" }
```

The service parses the string, validates the schema, recomputes the canonical string, and rejects the request when the recomputed string differs from the submitted string or when `batchCode` differs from the code inside the JSON. It then pins the exact submitted bytes to Kubo with CIDv1 and returns:

```json
{ "cid": "bafy...", "metadataHash": "0x..." }
```

The client signs `registerBatch` only when the returned `metadataHash` equals the hash it computed locally.

Kubo's HTTP API is `IPFS_API_URL`. Inside Compose that is `http://ipfs:5001`. From the host it is `http://127.0.0.1:5001`. The browser does not call Kubo directly. The pin service is `services/pin`, a small HTTP process on port `8788`. It does not import the indexer and it does not open Postgres. Kubo's default add wraps a file in UnixFS, so the CID is not a raw hash of the JSON bytes. The app does not recompute a CID. The CID is the retrieval key. The keccak commitment is the integrity check.

### Verification of a document

The page requests `/ipfs/{metadataCid}` using the CID stored on the contract. Given the fetched bytes, **match** requires all of these:

1. `keccak256` of the exact fetched bytes equals the on-chain `metadataHash`.
2. Re-canonicalizing the parsed JSON produces those same bytes.
3. `batchCode` inside the JSON equals the batch code in the URL.
4. `computeBatchId` of that batch code equals the id used to read the contract.

**Mismatch** means the fetch succeeded and any of those checks failed. **Unavailable** means the fetch failed. Chain custody, status, hashes, and transactions still render in both cases. The page does not replace them with indexer fields.

## 11. QR codes

The QR payload is an absolute URL:

```text
{origin}/verify/{chainId}/{contractAddress}/{batchCode}
```

Example shape:

```text
https://proofchain.example/verify/11155111/0xContract/PCB-2026-001
```

The image is generated in the browser after a successful registration receipt. It is not stored on Ethereum, on IPFS, or in PostgreSQL. The same URL can be turned back into a QR image at any time. A downloaded PNG is a convenience for printing.

The default origin is the QR-origin field on the registration screen. That field starts as `VITE_PUBLIC_ORIGIN` when set, and otherwise as the page origin. The contract address in the path is EIP-55 checksummed. The page accepts any hex case for that address. If the encoded origin is `localhost` or `127.0.0.1`, the registration confirmation warns that a phone cannot open it.

Batch codes are case-sensitive and URL-safe by the contract rule in section 12, so the code is a single path segment and is not lowercased.

## 12. Contract

File: `contracts/src/ProductRegistry.sol`.

The contract inherits OpenZeppelin `AccessControl`. It has no external calls, so it does not need a reentrancy guard. It is not upgradeable and it cannot be paused.

### Roles

```text
DEFAULT_ADMIN_ROLE   OpenZeppelin admin. Grants and revokes the two roles below.
MANUFACTURER_ROLE    keccak256("MANUFACTURER_ROLE")
RECALL_ROLE          keccak256("RECALL_ROLE")
```

Constructor: `constructor(address admin)`. `admin` receives `DEFAULT_ADMIN_ROLE`. Address zero reverts.

Distributors and retailers have no role. Being the named recipient is the only authority required to accept a handoff.

Use `onlyRole(MANUFACTURER_ROLE)` on `registerBatch` only. That modifier runs before the function body, so an unauthorized caller gets `AccessControlUnauthorizedAccount` even when the batch code is already taken. `recallBatch` does not use the modifier. It calls `_checkRole(RECALL_ROLE, msg.sender)` after the existence and status checks below. Unauthorized role calls still revert with OpenZeppelin's `AccessControlUnauthorizedAccount`.

### Types

```solidity
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
```

`Status.None` is unset storage. Existence is `status != Status.None`. There is no second `exists` flag. A successful `getBatch` returns `Active` or `Recalled`.

### Functions

```solidity
function computeBatchId(string calldata batchCode) external pure returns (bytes32);

function registerBatch(
    string calldata batchCode,
    bytes32 metadataHash,
    string calldata metadataCid
) external;

function proposeCustodyTransfer(bytes32 batchId, address to) external;

function cancelCustodyTransfer(bytes32 batchId) external;

function acceptCustodyTransfer(bytes32 batchId) external;

function recallBatch(bytes32 batchId, string calldata reason) external;

function getBatch(bytes32 batchId) external view returns (Batch memory);

function getPendingTransfer(bytes32 batchId) external view returns (PendingTransfer memory);

function getCustodyHistory(bytes32 batchId) external view returns (CustodyRecord[] memory);
```

`computeBatchId` returns `keccak256(bytes(batchCode))` after the same validation `registerBatch` uses, so an invalid code reverts in both places.

There is no `updateMetadata`, no `burn`, and no function that turns a recalled batch back into an active one.

### `registerBatch`

- Caller has `MANUFACTURER_ROLE`.
- `batchCode` length is 1 through 64.
- Every character is `A-Z`, `a-z`, `0-9`, or `-`.
- `batchId = keccak256(bytes(batchCode))` is not already registered.
- `metadataHash` is not `bytes32(0)`.
- `metadataCid` length is 1 through 128.
- Every CID character is printable ASCII from `0x21` through `0x7E`. Spaces are rejected.
- Manufacturer and current custodian are both `msg.sender`.
- Status is `Active`. `createdAt` is `uint64(block.timestamp)`.
- No pending transfer. History is empty.
- Store `batchCode` so a log reader can recover the human code without IPFS.

### `proposeCustodyTransfer`

- The batch exists and is `Active`.
- `msg.sender` is `currentCustodian`.
- No pending transfer is active.
- `to` is not the zero address and is not the current custodian.
- Pending becomes active, with `from = msg.sender`, `to = to`, and `proposedAt = uint64(block.timestamp)`.

### `cancelCustodyTransfer`

- The batch exists and is `Active`.
- A pending transfer is active.
- `msg.sender` is the current custodian.
- `pending.from` is the current custodian.
- Clear the pending transfer.

### `acceptCustodyTransfer`

- The batch exists and is `Active`.
- A pending transfer is active.
- `msg.sender` is `pending.to`.
- Copy `pending.from` and `pending.to` to memory first.
- Set `currentCustodian` to that recipient.
- Clear the pending transfer.
- Append a `CustodyRecord` from the copied values, with `timestamp = uint64(block.timestamp)`.

### `recallBatch`

- The batch exists. A missing batch reverts `BatchNotFound` before the role is checked.
- Status is `Active`. A second recall reverts `AlreadyRecalled` before the role is checked.
- Caller has `RECALL_ROLE`, checked with `_checkRole` after the two checks above.
- `reason` is at most 128 bytes. Longer input reverts `InvalidReason`. An empty string is allowed and means no reason was given.
- If a pending transfer is active, clear it and record that it was cleared.
- Status becomes `Recalled`. The reason is stored in the event, not as a second status.

### Reads

- `getBatch` and `getCustodyHistory` revert when the batch does not exist. An existing batch may have an empty history.
- `getCustodyHistory` returns accepted handoffs oldest first.
- `getPendingTransfer` reverts when the batch does not exist. When the batch exists and nothing is pending, it returns `active = false` and zeroed fields.
- Clearing a pending transfer sets `active` to false and sets `from`, `to`, and `proposedAt` to zero.

### Check order

For `proposeCustodyTransfer`, `cancelCustodyTransfer`, and `acceptCustodyTransfer`:

1. `BatchNotFound` when the batch does not exist.
2. `AlreadyRecalled` when the status is not `Active`.
3. The custodian, recipient, and pending checks for that function.

For `recallBatch`:

1. `BatchNotFound` when the batch does not exist.
2. `AlreadyRecalled` when the status is not `Active`.
3. `_checkRole(RECALL_ROLE, msg.sender)`.
4. The reason length, then the state change.

A stranger proposing a recalled batch therefore sees `AlreadyRecalled`. A stranger recalling an active batch sees `AccessControlUnauthorizedAccount`. A stranger recalling an already recalled batch sees `AlreadyRecalled`, because the status is public through `getBatch` anyway. Do not put `onlyRole` on `recallBatch`. It would run before those checks and reverse this order.

### Errors

```solidity
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
```

`InvalidMetadata` covers a zero hash and a CID that fails the length or character rule.

### Events

```solidity
event BatchRegistered(
    bytes32 indexed batchId,
    address indexed manufacturer,
    string batchCode,
    bytes32 metadataHash,
    string metadataCid,
    uint64 createdAt
);

event CustodyTransferProposed(
    bytes32 indexed batchId,
    address indexed from,
    address indexed to,
    uint64 proposedAt
);

event CustodyTransferCancelled(
    bytes32 indexed batchId,
    address indexed from,
    address indexed to,
    uint64 cancelledAt
);

event CustodyTransferred(
    bytes32 indexed batchId,
    address indexed from,
    address indexed to,
    uint64 timestamp
);

event BatchRecalled(
    bytes32 indexed batchId,
    address indexed recalledBy,
    bool pendingCleared,
    uint64 recalledAt,
    string reason
);
```

Emit the matching event after the state write succeeds. `CustodyTransferCancelled.cancelledAt` and `BatchRecalled.recalledAt` are `uint64(block.timestamp)`.

### State machine

```text
unregistered --registerBatch--> active
active --propose--> active with one pending handoff
active with pending --accept--> active, new custodian, pending cleared, history appended
active with pending --cancel--> active, pending cleared
active --recall--> recalled
active with pending --recall--> recalled, pending cleared
```

Rejected transitions include a second pending proposal, accept by the wrong wallet, cancel by anyone except the current custodian, any handoff function after recall, recall of an unknown batch, and recall of an already recalled batch.

### Invariants

- A batch that has been recalled has status `Recalled` forever after.
- `manufacturer` never changes.
- An existing batch has a non-zero manufacturer and a non-zero current custodian.
- If a pending transfer is active, the batch is `Active`, `pending.from` equals `currentCustodian`, and `pending.to` is non-zero and different from the custodian.
- On-chain history grows only when `acceptCustodyTransfer` succeeds, and only by that one record.
- The custodian changes only when `acceptCustodyTransfer` succeeds.

### Deploy script

`contracts/script/Deploy.s.sol` reads:

```text
PRIVATE_KEY
ADMIN_ADDRESS
MANUFACTURER_ADDRESS
RECALLER_ADDRESS
```

It deploys `ProductRegistry(ADMIN_ADDRESS)` and grants the manufacturer and recall roles. `vm.addr(PRIVATE_KEY)` must equal `ADMIN_ADDRESS`, because only the admin can grant those roles in the same script. For a local solo demo, the manufacturer and recaller addresses may be the same account. The script prints the contract address. Local demo accounts are Anvil's public development accounts in order: 0 is A, 1 is B, 2 is C, and 3 is D. The README may quote the keys Anvil prints and must label them as public development keys that are never used on Sepolia or mainnet.

Never commit a private key or a filled `.env`.

### Contract tests

`ProductRegistry.t.sol` covers the successful path and a revert for every rejected transition in this section, including duplicate batch codes, bad batch-code characters, a zero hash, an empty CID, a CID longer than 128 characters, a zero recipient, a self-handoff, a second proposal, accept and cancel by the wrong wallet, recall clearing a pending handoff, a second recall, a reason longer than 128 bytes, an empty reason, and the recall check order: a stranger gets `AlreadyRecalled` on a recalled batch and `AccessControlUnauthorizedAccount` on an active batch.

`ProductRegistryFuzz.t.sol` fuzzes unauthorized callers. Register uses a valid batch code, a non-zero hash, and a valid CID, and expects `AccessControlUnauthorizedAccount`. Recall runs against an active batch the manufacturer already registered, and an unauthorized caller expects `AccessControlUnauthorizedAccount`. Propose, accept, and cancel run against that same kind of batch, with a caller who is not the authorized wallet, and expect `NotCurrentCustodian` or `NotPendingRecipient`. Invalid random strings are not the point of this file.

`ProductRegistryInvariant.t.sol` drives a handler that already holds the roles and the actor set. The handler catches expected reverts. The invariant assertions are the list in this section. Use at least 64 runs and depth 32.

`forge test` passes before the package is done.

## 13. Indexer

The indexer is a derived projection of one contract's logs. It is rebuilt from those logs after a restart or a reorg.

### Configuration

| Variable | Local default |
| --- | --- |
| `DATABASE_URL` | `postgres://proofchain:proofchain@127.0.0.1:5432/proofchain` |
| `CHAIN_RPC_URL` | `http://127.0.0.1:8545` |
| `CHAIN_ID` | `31337` |
| `CONTRACT_ADDRESS` | deployment output |
| `START_BLOCK` | deployment block |
| `CONFIRMATIONS` | `0` on Anvil, `2` on Sepolia |
| `IPFS_API_URL` | `http://127.0.0.1:5001` on the host, `http://ipfs:5001` inside Compose |
| `INDEXER_PORT` | `8787` |
| `WEB_ORIGIN` | the Vite origin, for CORS |

The host defaults above are for a process run on the laptop. The Compose indexer overrides `CHAIN_RPC_URL` to `http://anvil:8545` and `DATABASE_URL` to the `postgres` service. Using `127.0.0.1` inside a container points at the container itself.

The local database password is a development default, not a production secret. It still lives in `.env`, not in source.

`indexer_meta` records the chain id and contract address of the first successful start. If the environment later disagrees, the process refuses to run. A resync does not silently switch chains. Changing contract or chain means an empty database.

### Tables

`indexer_meta` is a single row: `chain_id`, `contract_address`, `start_block`, `start_block_hash`, `last_processed_block`, `last_processed_hash`.

`blocks`: `number` primary key, `hash`, `parent_hash`.

`logs`: `block_number`, `block_hash`, `tx_hash`, `log_index`, `event_name`, `payload` JSON, `applied` boolean. Primary key `(tx_hash, log_index)`.

`batches`: `batch_id` primary key, `batch_code` unique, `manufacturer`, `current_custodian`, `metadata_hash`, `metadata_cid`, `status` (`active` or `recalled`), `created_at`, `created_block`, `created_tx`, `recalled_at`, `recalled_block`, `recalled_tx`, `recall_pending_cleared`, `recall_reason`.

`pending_transfers`: `batch_id` primary key, `from_address`, `to_address`, `proposed_at`, `proposed_block`, `proposed_tx`. A row exists only while the handoff is pending.

`custody_transfers`: `batch_id`, `from_address`, `to_address`, `accepted_at`, `block_number`, `tx_hash`, `log_index`. Unique `(tx_hash, log_index)`.

Store addresses in lowercase hex. Store hashes with the `0x` prefix. Store batch ids as `0x` plus 64 hex characters.

### Sync

1. If `indexer_meta` is missing, the cursor is empty and the first scanned block is `START_BLOCK`, inclusive. Do not use `START_BLOCK - 1`. Block 0 is a legal deployment block.
2. If the chain head is below `CONFIRMATIONS`, wait. Otherwise `safeHead` is head minus `CONFIRMATIONS`. Blocks above `safeHead` stay out of the database, which keeps a shallow reorg from becoming a rewrite.
3. Store every block header from `START_BLOCK` through `safeHead`, not from genesis, including blocks that contain no product logs. On the first stored header, save its hash as `start_block_hash`. If the node later reports a different hash at `START_BLOCK`, or `getBlock` cannot find `last_processed_block` because the chain was reset, truncate the indexer tables and start again. That is the expected result of restarting Anvil against a persisted Postgres volume. If a stored height still exists but its hash differs, walk downward until a stored hash matches. That height is the common ancestor. Delete blocks and logs above it, delete every projection row, mark the remaining logs unapplied, and replay them in `(block_number, log_index)` order. If no stored height matches, truncate and start again at `START_BLOCK`.
4. Fetch logs for the five product event topics from the contract, from the cursor through `safeHead`, in ranges of at most 2000 blocks. Insert with `ON CONFLICT DO NOTHING`. Ignore `RoleGranted`, `RoleRevoked`, and any other topic. A log that claims to be one of the five events and then fails to decode pauses the sync loop and sets `syncOk` to false. It does not exit the process. The pin service is a different process, so pinning is unaffected.
5. Apply logs where `applied = false`, in `(block_number, log_index)` order, inside a database transaction. Then set `applied = true`. Projection timestamps come from the event arguments, converted from Unix seconds. They do not come from the indexer's wall clock.
6. Advance the cursor to `safeHead` only after that range's headers and logs are stored.
7. Poll about every 2 seconds. A restart continues from `indexer_meta`. If the RPC is down, keep the process alive and report the failure on `/health`.
8. A resync command truncates the indexer tables and runs the loop from `START_BLOCK` again.

Applying a log twice does not create a second handoff or a second batch. Projection code uses the primary keys above.

`BatchRegistered` inserts a batch. `CustodyTransferProposed` inserts a pending row. `CustodyTransferCancelled` deletes it. `CustodyTransferred` updates the custodian, deletes the pending row, and inserts history in oldest-first order. `BatchRecalled` sets recalled fields, stores `reason`, and deletes any pending row. `pendingCleared` is stored so it can be shown. Pinning is not this process.

### HTTP API

All responses are JSON. CORS allows `WEB_ORIGIN`.

`GET /health`

```json
{
  "ok": true,
  "syncOk": true,
  "pinOk": true,
  "lastProcessedBlock": "0",
  "headBlock": "0"
}
```

When the RPC is unreachable or sync is paused, `syncOk` is false, `ok` is false, and `headBlock` may be null. `lastProcessedBlock` is still reported. `pinOk` reports whether this process can see the pin service. Pinning itself does not run here. A chain or contract mismatch still refuses to project, as this section requires.

`GET /batches?participant=0x...&status=active&q=PCB`

`q` matches a batch-code prefix, preserving case, or a full address. `participant` matches the manufacturer, the current custodian, or the pending recipient, so account A still sees a batch after handing it to B. `status` is `active` or `recalled`.

`GET /batches/:batchKey` treats a key of `0x` plus 64 hex characters as a batch id. Every shorter key is a case-sensitive batch code. A valid batch code cannot be 66 characters, so the two forms do not collide. The response is:

```json
{
  "batchId": "0x9d6b…",
  "batchCode": "PCB-2026-001",
  "manufacturer": "0x…",
  "currentCustodian": "0x…",
  "metadataHash": "0x…",
  "metadataCid": "bafy…",
  "status": "active",
  "createdAt": "2026-10-29T12:00:00.000Z",
  "createdBlock": "1",
  "createdTx": "0x…",
  "recalledAt": null,
  "recallReason": null,
  "pending": null,
  "history": [
    {
      "from": "0x…",
      "to": "0x…",
      "timestamp": "2026-10-29T12:05:00.000Z",
      "blockNumber": "2",
      "txHash": "0x…"
    }
  ]
}
```

When a handoff is pending, `pending` is `{ "from", "to", "proposedAt", "proposedTx", "proposedBlock" }`.

`GET /batches/:batchKey/history` returns the history array, using the same key rule.

`POST /blobs` and `POST /metadata` are served by `services/pin`, not by this process. The verification page never calls either service to decide what is true. The indexer GET routes are what `/api` proxies for dashboard search.

### Indexer tests

Unit tests, with no Docker, cover:

- Applying the five events in order produces the registration, one pending handoff, an accepted handoff, and a recall that clears a pending handoff.
- Applying the same log twice does not duplicate history.
- A reorg that replaces the tip removes the dropped logs and the projection built from them, then replay restores the surviving history.
- A stored start-block hash that no longer matches the node truncates the projection and starts again.

Pin tests live in `services/pin`. A non-canonical body, a wrong `schemaVersion`, and an empty `name` fail before a pin is attempted. The Kubo call sits behind a small interface so the unit test can use a fake pinner. `services/pin` does not import the indexer.

## 14. Web application

Environment:

```text
VITE_CONTRACT_ADDRESS=
VITE_PUBLIC_ORIGIN=
VITE_INDEXER_URL=
VITE_IPFS_GATEWAY_URL=
RPC_URL=http://127.0.0.1:8545
PIN_URL=http://127.0.0.1:8788
```

Client code does not read `RPC_URL` or any provider secret. The dev server reads `RPC_URL` and proxies `/rpc` to it. A hosted static build has no Vite server, so each chain entry in `trusted-deployments.json` carries a keyless public `rpcUrl`. An empty `rpcUrl`, or an `eth_chainId` result that differs from the chain id in the URL, shows "This site cannot read chain N". It does not show "batch not found". A secret RPC key is never committed and never placed in a `VITE_` variable.

Empty `VITE_INDEXER_URL` and `VITE_IPFS_GATEWAY_URL` mean same-origin `/api` and `/ipfs`. `VITE_PUBLIC_ORIGIN` only prefills the QR-origin field. Log queries start at the matched deployment's `startBlock` and request at most 2000 blocks at a time. If a provider rejects a range, the page retries with a smaller range. If logs still cannot be loaded, custody history comes from `getCustodyHistory` and transaction hashes are marked unavailable. The rest of the page still renders.

`apps/web/trusted-deployments.json`:

```json
{
  "deployments": [
    {
      "chainId": 31337,
      "address": "0x0000000000000000000000000000000000000000",
      "startBlock": 0,
      "label": "local anvil",
      "current": true,
      "rpcUrl": ""
    }
  ]
}
```

The checked-in file starts with an empty `deployments` array. The deploy helper appends the real address. For local Anvil, `rpcUrl` stays empty and the page uses same-origin `/rpc`. For Sepolia, `rpcUrl` is a keyless public endpoint. `current: true` marks the deployment new QRs should use. Older entries stay in the list with `current: false` so printed labels keep verifying. Comparison of addresses is case-insensitive. `getLogs` starts at that entry's `startBlock`.

The ABI imported by the app is the ABI produced by `forge build`. Do not hand-maintain a drifted copy. A checked-in `apps/web/src/contracts/ProductRegistry.ts` generated from that ABI is fine if the generation command is in the README.

Behavior worth preserving:

- Public verification calls `eth_chainId` before reading a batch. The chain id in the URL must match. A Sepolia label opened against an Anvil reader shows that this site cannot read that chain.
- It uses a Viem public client aimed at same-origin `/rpc` in development. A static build uses the keyless `rpcUrl` on the matched deployment. It calls `getBatch`, `getPendingTransfer`, `getCustodyHistory`, and `hasRole(MANUFACTURER_ROLE, manufacturer)`. Log reads follow the chunking rule above. The connected wallet's network does not change that read.
- If the chain id and address are not in `trusted-deployments.json`, the page shows a hard warning that this is not a recognized deployment and it does not show a green seal. It still shows the raw reads.
- A recognized earlier deployment shows the data and says it is an earlier contract, with the current address beside it.
- The company name is labeled as claimed in the document. The registering wallet is shown separately, with the live manufacturer-role result.
- It shows match, mismatch, or unavailable as section 10 defines. The green seal requires a trusted deployment and a match.
- It shows on-chain custody even when IPFS is down.
- It shows the recall reason when one was given.
- It shows a warning when `getCustodyHistory` and the `CustodyTransferred` logs disagree in count or order.
- It does not read PostgreSQL.
- It shows a `cast call` for `getBatch` using the contract address and a node URL the reader can replace. On chain id `11155111` it also links the contract and each transaction to `https://sepolia.etherscan.io`. The page says its own read went through the site's reader.
- Before a write, the app checks that the wallet chain id equals the chain id of the current trusted deployment and requests a switch when it does not. The wallet's RPC is `http://127.0.0.1:8545` for Anvil, configured in the wallet itself.
- Registration shows the QR only after a successful receipt, with the batch code, the checksummed contract address, the metadata hash, the CID, and the transaction hash.
- Custody and recall display the contract error text when a call reverts. Recall sends a reason string, or an empty string when the field is blank.
- Wallet connection is required for actions. The verification route does not connect a wallet and does not prompt for one.
- Dashboard lists use `/api`. Roles use `hasRole` on the contract.

Generate the QR from the origin field on the registration screen, plus the route in section 11. The dev server implements the proxy rules in section 4, including `server.allowedHosts` when a tunnel is used. One acceptance check is `curl -H 'Host: localhost' http://<lan-ip>:5173/api/metadata` from another machine, which must be rejected. A phone browser refusing the button is not that check. A second check sends a JSON-RPC array that mixes `eth_chainId` with `eth_sendTransaction` and must be rejected in full.

## 15. Local stack and deployment

`docker-compose.yml` runs:

| Service | Host publish | Notes |
| --- | --- | --- |
| `anvil` | `127.0.0.1:8545` | Image `ghcr.io/foundry-rs/foundry`, command `anvil --host 0.0.0.0 --port 8545 --chain-id 31337`. Automine stays on. Inside Compose the RPC is `http://anvil:8545`. |
| `postgres` | `127.0.0.1:5432` | User, password, and database `proofchain`. A volume keeps the index across restarts. Inside Compose the host is `postgres`. |
| `ipfs` | `127.0.0.1:5001` and `127.0.0.1:8080` | Kubo. The pin service uses the API. The browser reaches files through the Vite `/ipfs` proxy, not through this published gateway. |
| `pin` | `127.0.0.1:8788` | `services/pin`. Talks only to Kubo. No Postgres. |
| `indexer` | `127.0.0.1:8787` | Starts after Postgres. Reads the contract address from the environment. Calls `http://anvil:8545`. |

Publishing those ports on localhost keeps the pin API off the LAN. The phone reaches the laptop through Vite, which is the process bound to `0.0.0.0:5173`.

The web app runs with `pnpm --dir apps/web dev` on the host so UI work stays fast.

Contract deployment against local Anvil uses the Foundry script. After it prints the address, that address is written into the local `.env` files by the person running the demo, or by a small shell helper that only updates `CONTRACT_ADDRESS` and `VITE_CONTRACT_ADDRESS`. The helper must not print private keys.

Sepolia deployment uses the same script, a user-supplied RPC URL, and a user-supplied testnet key in `.env`. Test ETH only. Do not deploy to mainnet. Do not invent a funded key.

`.env.example` lists every variable in this plan with empty secrets and the local defaults for non-secrets.

If the Docker daemon is not running, start it. If starting it needs a password from the user, stop and ask. Pure unit tests for metadata, event application, and reorgs do not require Docker.

## 16. Security and assurance

Contract tests are the first assurance. They must fail closed on every rejected transition in section 12.

The invariant suite is the second. It exists to catch a sequence the unit tests did not name, especially a recalled batch becoming active or a custodian changing without an acceptance.

Install Slither and run it against `contracts/`. Record the result in `docs/threat-model.md`, including any finding that is accepted and why. The Foundry tests remain the executable specification. A tool that cannot be installed is recorded as a gap, not treated as a pass.

Threat model to write in `docs/threat-model.md`, in the project's own words:

- What an external account can try, and which error stops it.
- What the admin can do, including granting a manufacturer who then registers a false document.
- What a current custodian can do, including proposing a handoff to an address that never accepts, and cancelling that proposal.
- What IPFS pinning loss looks like to a reader.
- What a copied QR label does and does not prove.
- What a manufacturer can do by registering a hash and a CID that do not point at the same bytes, and how the page shows mismatch.
- What the indexer can get wrong during downtime or a reorg, and why the public page still has a direct Ethereum path.
- That pending handoffs are visible before the recipient accepts, and that the public record reveals a supplier graph.
- That batch codes are a global namespace and the first manufacturer to register a code owns it.
- That one admin key can appoint a manufacturer.
- That a lookalike contract can print a QR, and the green seal is limited to the trusted-deployment list.
- That a LAN reader is trusting the site's RPC proxy, and the `cast call` plus the explorer are the independent path.
- That custody history is unbounded in this version.
- Who pays gas: the wallet that submits the transaction, in test ETH for this demo.

The web app has automated checks for a reverted transaction, an RPC error, and an unreachable gateway. The page shows those failures. It does not show a successful registration when the receipt failed.

## 17. Explanation the README should carry

The README opens with the one-sentence definition from section 1, then the limitation about physical goods and copied labels, then how to run the stack, then the demo sequence from section 4. It links to this file for the protocol and to `docs/threat-model.md` for the trust write-up.

## 18. Work packages

The product scope is unchanged. Packages run in parallel only where their directories do not overlap. The public verification page reads the chain directly, so the web app and the indexer can be built together. That split is about ownership of files. It does not make the indexer optional.

Shared files have one owner, the integration brief: `docker-compose.yml`, `.env.example`, `pnpm-workspace.yaml`, the root `package.json`, and the deploy helper that writes the contract address into `.env` and `trusted-deployments.json`. Other briefs do not edit those files.

These steps need the user, and an executor stops rather than inventing them: starting the Docker daemon if it asks for a password, clicking a wallet prompt, joining the phone to the laptop's network, and obtaining Sepolia faucet ETH.

### Parallel, first

**Package 1. Contract.** Install Foundry if `forge` is missing. Official `foundryup` into the user home is appropriate. Initialize git if the workspace has no repository, because Foundry tracks libraries that way. Do not create a commit. Create `contracts/`, install OpenZeppelin Contracts 5.x, and implement section 12, including the deploy script and the three test files.

Done when `forge test` passes, the golden `batchId` for `PCB-2026-001` matches section 10, and an unauthorized account cannot register, propose, accept, cancel, or recall.

**Package 2. Metadata and pin.** Create `packages/metadata` and `services/pin`. Implement section 10. No Postgres and no log follower.

Done when the golden metadata hash matches section 10, and `POST /metadata` rejects a non-canonical body before any pin is attempted.

### Parallel, after the ABI exists

**Package 3. Web application.** Create `apps/web` and implement sections 4, 5, 11, and 14 against the real ABI and the real metadata package. Dashboard lists already say they are unavailable when the indexer is down. The public page never needs it.

Done when a local Anvil walkthrough, operated from `http://localhost:5173`, can register the demo batch, edit the QR origin and download that QR, accept two handoffs, show a contract revert for account D, recall the batch with a short reason, and show each of those states on `/verify/...` without a wallet. A phone on the same network can load that page through `/rpc` and `/ipfs`. `curl -H 'Host: localhost' http://<lan-ip>:5173/api/metadata` from another machine is rejected. A JSON-RPC batch containing `eth_sendTransaction` is rejected in full. An unrecognized contract shows the warning and no green seal. A URL whose chain id does not match `eth_chainId` says this site cannot read that chain.

**Package 4. Indexer.** Create `indexer/` and implement section 13. Do not modify `services/pin`.

Done when duplicate log application is idempotent, the reorg test rewinds a replaced tip, and a changed `start_block_hash` truncates and starts again.

### After the local demo

**Package 5. Demo path, security, and write-up.** Write `README.md` and `docs/threat-model.md` from sections 6, 16, and 17. Deploy the contract to Sepolia with the user's own RPC and a funded test key, and record the address in `trusted-deployments.json` with a keyless public `rpcUrl`. Produce the static `vite build`. The README separates the LAN demo from a demo that survives the laptop leaving the room. The second one needs hosted files, a keyless public RPC, and pins a public gateway can fetch. Say plainly which of those are actually in place. Install and run Slither. Add a CI workflow that runs `forge test` and the Node unit tests. Keep a recording of the full local path: register, two handoffs, the rejected transfer, recall, and the phone page.

Done when a stranger can follow the README from a clean machine to the local demo, the phone path has been opened once, Slither's result is written down, CI runs the test suites, and the Sepolia section matches what was actually deployed and hosted.

### Integration gate

The local demo in package 3 is the gate for package 5, because the write-up describes a system that has been exercised. The indexer is held to section 13 whether or not that demo is already green. A package is finished when its done criteria pass. Nothing in this list is dropped to save time.

## 19. Current machine

Re-check before relying on this.

As of 30 October 2026, after the GitHub push:

- Packages 1 through 4 and the integration files are accepted. `master` on https://github.com/Ripper2005/ProofChain is commit `98f5636`. There is no `README.md`, no `docs/threat-model.md`, no `.github` workflow, and no Sepolia deployment.
- Foundry 1.8.6 is in the user home. The nested `contracts/.git` is gone. Foundry libraries are vendored in `contracts/lib`.
- Host processes that were up: Anvil on `127.0.0.1:8545`, pin on `127.0.0.1:8788`, Kubo on `127.0.0.1:5001` and `127.0.0.1:8080`, Vite on `0.0.0.0:5173`. Postgres and the indexer were not listening. The Docker daemon was down and starting it needs the user's password.
- The local Anvil chain already contains the demo batch `PCB-2026-001`, both handoffs, two reverted calls from account D, and a recall with reason "Damaged seal". The public page showed Recalled and Match.
- `.env` exists locally and is gitignored. Do not commit it. `PRIVATE_KEY` in `.env.example` is empty.
- The Sepolia deploy account is `0xC369d193b2C6594da0dEB59C484D906F3F69CFAB`. On 30 October 2026 it held 0.05 Sepolia ETH, chain id 11155111, nonce 0. The private key stays in the user's wallet and in a local `.env` at deploy time. It is not written into this file.

## 20. Decision log

| Date | Decision |
| --- | --- |
| 2026-10-29 | Full product scope includes the contract, tests, web app, IPFS, PostgreSQL indexer, public verification, and the trust write-up. |
| 2026-10-29 | A 31 October date was discussed. It is not a reason to thin a package. |
| 2026-10-30 | Quality is independent of the calendar. The indexer, Slither, CI, the threat model, and an honest Sepolia path stay in the finished project. The local demo gates the write-up. It does not excuse skipping the indexer. |
| 2026-10-29 | The user and the agent sessions build the product. Teammates are not an implementation plan. |
| 2026-10-29 | Planning session specifies and verifies. Executor sessions implement one package at a time. |
| 2026-10-29 | Custody language, two-step handoff, admin-granted manufacturer and recall roles, one pending handoff, cancel, recall clears pending, history stored on-chain and in logs. |
| 2026-10-29 | Batch id is `keccak256` of the human batch code. The code is also stored on-chain. |
| 2026-10-29 | QR encodes the verification URL and is regenerated in the browser. It is not an authoritative stored image. |
| 2026-10-29 | Public verification reads Ethereum and IPFS. The indexer serves dashboard search. |
| 2026-10-29 | One QR per batch or package, not per component. Metadata is append-only by deploying a new registration rather than editing the old one. |
| 2026-10-29 | Demo chain is Sepolia. Local chain is Anvil. Account A may hold both demo roles. Tests keep the roles separate. |
| 2026-10-29 | Pre-implementation review. Protocol unchanged. Phone traffic goes through same-origin `/rpc`, `/ipfs`, and `/api`. Integrity is the keccak check, and the CID is only the locator. Recalled batches fail with `AlreadyRecalled` before the custodian check. Pending rows are zeroed on clear. The indexer stores every header from the deployment block, ignores role events, and refuses a chain or contract change. |
| 2026-10-29 | Second review. All four packages stay. `/rpc` is read-only and pin POST is limited to a localhost Host. Green seals require `trusted-deployments.json`, which can list old and current contracts. `recallBatch` takes a reason of at most 128 bytes and checks the role with `_checkRole` after existence and status. Pin routes stay up when sync pauses. An Anvil reset is detected from `start_block_hash` and resynced. Sepolia does not by itself outlive the laptop. |
| 2026-10-29 | Third review. Proxy POST requires a loopback TCP peer and a localhost Host. JSON-RPC batches are rejected in full, and `/rpc` has no WebSocket upgrade. The verification page compares `eth_chainId` with the URL and chunks `getLogs`. Client code does not read an RPC secret. The QR origin is an editable field. Pin lives in `services/pin`. Contract and pin run in parallel. Web and indexer run in parallel after the ABI exists. The local demo does not wait on the indexer. |
| 2026-10-30 | Packages 1 and 2 accepted after `forge test` (28 passed) and the Node suites (5 and 7 passed). Golden batch id and metadata hash match. `ZeroAddress` is only a zero admin. A zero recipient and a self-handoff are `InvalidRecipient`. Propose and cancel check the custodian before the pending handoff. Accept checks that a handoff is pending before it checks the recipient. `registerBatch` checks the code, then a duplicate id, then the hash, then the CID, after `onlyRole`. The deploy script reverts with `AdminKeyMismatch(address,address)`. Metadata strings must already be trimmed. Package names are `@proofchain/metadata` and `@proofchain/pin`. Pin listens on `127.0.0.1:8788`. |
| 2026-10-30 | Packages 3, 4, and the integration files accepted. The local Anvil chain holds the demo batch, both handoffs, two reverted calls from account D, and a recall whose reason is "Damaged seal". The public page shows Recalled and Match for that batch. Indexer unit tests are 23 passed. Web unit tests are 10 passed. `CONFIRMATIONS` defaults to 0, and to 2 when `CHAIN_ID` is 11155111. The indexer listens on `127.0.0.1` unless `INDEXER_HOST` is set. Docker was not started because it needs the user's password. |
| 2026-10-30 | The workspace was pushed to the private repository https://github.com/Ripper2005/ProofChain, commit `98f5636`, branch `master`. `.env`, Foundry `cache`, `out`, and `broadcast` stay untracked. Package 5 is the remaining work. |
| 2026-10-30 | Sepolia deploy account is `0xC369d193b2C6594da0dEB59C484D906F3F69CFAB`. It holds 0.05 test ETH. For the solo public demo this address is the admin, the manufacturer, and the recaller. The private key is not stored in the repository. |

## 22. Accepted from the first two packages

These choices were open in the plan. The implementations made them, the tests pass, and later packages use them as written.

- The nested `contracts/.git` directory was removed before the first commit. `contracts/lib` stays in the repository as vendored source. Do not delete it and do not turn it back into a nested repository.
- Pin errors are JSON `{ "error", "message" }`. `POST /metadata` accepts only `canonical` and `batchCode`. An empty blob is 400, a body over 5 MB is 413, and a Kubo failure is 502.
- Kubo is called with `cid-version=1` and `pin=true`.
- Hono is only the pin router. Unused Hono dependency paths reported by `npm audit` are not a reason to mount extra middleware.

## 21. Glossary

| Term | Meaning |
| --- | --- |
| Batch code | Human id such as `PCB-2026-001`. It appears in the URL and in the document. |
| Batch id | `keccak256` of the batch code's UTF-8 bytes. Primary key inside the contract and the indexer. |
| Custodian | The wallet that may currently propose or cancel a handoff. |
| Commitment | `metadataHash`, the `keccak256` of the canonical document bytes. |
| CID | IPFS content identifier for those same bytes, or for the optional file. |
| Receipt | The confirmed result of a transaction. Success is `status == 1`. |
| Projection | Indexer tables rebuilt from logs. Disposable. |
| Safe head | Latest block minus `CONFIRMATIONS`. The indexer does not project past it. |
| Match | Fetched document bytes satisfy every check in section 10. |
| Mismatch | The document loaded, and at least one of those checks failed. |
| Unavailable | The document could not be fetched. Chain state is still shown. |
