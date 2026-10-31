# ProofChain master plan

Status: phase 1 (packages 1 through 4 and the integration files) is accepted and was re-audited on 30 October 2026. Packages 5 through 9 were accepted on 31 October 2026. Packages 10 through 13 in section 18 are the remaining work. The private repository is https://github.com/Ripper2005/ProofChain, branch `master`.
Last updated: 31 October 2026.
Repository root: `/home/harsha/Documents/Blockchain Project/`.
Quality is not tied to a calendar date. Nothing in section 18 is dropped to save time.
This file is the specification. If a chat, a brief, or another document disagrees with this file, this file wins until the orchestrator changes it.

## 0. How this project is run

Harsha is the only human. He builds the product end to end with agent sessions. Course teammates are not an implementation plan. Do not split work across teammates, do not write role assignments for them, and do not leave parts unfinished on the assumption that a person will fill them in.

- **Orchestrator.** One planning session owns this file, the architecture, the briefs, and verification. It runs executors as subagents and reviews their work by reading the diff and re-running the checks itself. It does not accept an executor's summary as evidence. It edits this file when a decision changes and records the change in section 20.
- **Executor.** Implements one package from section 18. It follows the locked decisions, does not widen the product, and does not edit this file. When the package does not settle a question, it stops and reports instead of inventing an answer.

These steps always need Harsha's explicit yes at the time they happen: sending any Sepolia transaction, deploying a contract, publishing a site or contract source, pushing to GitHub, creating accounts or API keys, clicking a wallet prompt, and anything that needs `sudo`. Do not change NetworkManager, do not create a laptop hotspot, and do not run `sudo`.

Sections 1 through 17 are the product. Section 18 is the build order. Section 19 is a machine snapshot that goes stale. Section 20 is the decision log. Section 21 records options that were considered and not taken, so they are not reopened by accident. Keep this as one file so a new session can recover the whole project from it.

## 1. What ProofChain is

ProofChain is a shared custody log for a product batch, built on Ethereum.

A manufacturer registers one batch, such as a box of 50 boards. The registration transaction carries the product document itself. The contract hashes that document, stores the hash, the batch code, the current custodian, and whether the batch is active or recalled, and publishes the document in its registration event. A content-addressed copy of the document, and any attachment such as a photo or a certificate, is pinned to IPFS. Custody moves only when the current holder proposes a handoff and the named wallet accepts it. A recall role can freeze the batch. Anyone with the QR link can read the record from several independent Ethereum nodes, see whether they agree, and check the document against the commitment.

One sentence, for a professor or a demo:

> ProofChain is a shared custody log for a product batch: Ethereum records who registered it, who accepted each handoff, and whether it was recalled, and anyone can check that record without trusting one company's database.

About a minute:

A batch of components can pass through a manufacturer, a distributor, and a retailer, with each company keeping its own spreadsheet. When those records disagree, there is no common history to inspect. ProofChain puts the batch, the product document, its hash, the current custodian, and the recall status in an Ethereum contract. Custody moves only when the current holder proposes a transfer and the named recipient accepts it. A customer or auditor scans the QR code with a phone, and the page asks several independent Ethereum nodes for the same record, shows the sequence of handoffs with transaction hashes, and checks that the product document still matches the registered hash. The contract rejects an unauthorized transfer. What it cannot do is prove the physical goods match the story that was signed.

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
| Reader | One Ethereum node the verification page asks |
| Agreement | Independent readers returning the same record at the same block |

The company name in the form is a claim inside the product document. The manufacturer the contract recognizes is the wallet that signed `registerBatch`.

### Words that misstate the product

Avoid these in copy and in code comments that users or professors will see.

- **Ownership** and **legal title.** The contract records an operational handoff between wallets.
- **Decentralized** as the headline. Ethereum consensus is shared. An administrator still grants the manufacturer and recall roles.
- **Counterfeit detection.** The contract cannot tell that a physical object is genuine.
- **Immutable** without the hedge. Confirmed history is tamper-evident under normal Ethereum assumptions. The administrator, the pinned files, the readers, and the website are separate trust points, described in section 6.
- **Trustless** for the verification page. Agreement between independent readers is evidence, not proof.

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
| Other organizations trust the operator's procedures. | Another party can read the contract, the logs, and the document directly, from a node they choose. |
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
2. The app builds the canonical document from section 10 and computes `metadataHash`.
3. Before anything is pinned, the app simulates `registerBatch` against the write deployment with the real document and a placeholder CID that satisfies the CID rule. A missing role or a batch code that is already taken is reported here, and nothing is pinned.
4. If there is an optional file, the app uploads those exact bytes first and places the returned CID in `imageCid` before the document is hashed.
5. The app sends the canonical document to the pin service. The service checks it, pins those exact bytes to the local Kubo node and, when configured, to Pinata, requires both CIDs to be identical, and returns the CID, the hash, and whether a public copy exists.
6. The manufacturer's wallet calls `registerBatch(batchCode, document, metadataCid)`. The contract checks the manufacturer role, the batch code, a duplicate, the document length, and the CID rule. It computes `metadataHash = keccak256(document)` itself, stores the batch, and emits the document in `BatchRegistered`. It does not fetch IPFS, so it cannot prove the CID points at those bytes. A mismatched CID is a stored claim that verification shows as an IPFS copy mismatch.
7. The app waits for the transaction receipt. A transaction hash alone does not mean the batch exists. If the wallet rejects the prompt, or the receipt fails, any pin that already happened stays on IPFS and the UI does not offer a QR code.
8. After the receipt succeeds, the browser builds a QR image from the verification URL and offers a PNG download.

### Custody

1. The current custodian proposes a handoff to a wallet address.
2. The batch now has one pending handoff. Another proposal reverts until this one is accepted or cancelled.
3. The named recipient accepts. The contract updates the current custodian and appends the handoff to on-chain history.
4. The current custodian may cancel a pending handoff instead.

Before the wallet opens for any of these, the app simulates the call as the connected wallet. If the contract would reject it, the page shows the decoded contract error and sends nothing. A "Send anyway" button submits it, so the rejection can be recorded on-chain when that is the point of the demo.

### Recall

A recall-role wallet recalls the batch. Any pending handoff is cleared. The status becomes recalled. Later propose, accept, and cancel calls revert. The same QR link shows the recalled status. Recall uses the same simulate-first rule.

### Public verification

A phone opens the QR URL with no wallet. The page asks every configured reader for the record at one anchor block, compares their answers, reads the registration event for the document, fetches the IPFS copy, and judges the document. PostgreSQL is not on this path. The document result is one of three successful page states: **match**, **mismatch**, or **unavailable**. A mismatch is a finding, not an application crash.

## 4. Live demo

### Primary path: the hosted site on Sepolia

The demo that counts runs on Sepolia, chain id `11155111`, with a hosted copy of the web app. A phone needs only mobile data. It does not need to reach the laptop, so venue Wi-Fi client isolation cannot break it.

| Actor | Opens | Reads from | Writes to |
| --- | --- | --- | --- |
| Phone in the audience | the hosted site | the Sepolia readers in `trusted-deployments.json` and the IPFS gateways | nothing |
| Laptop, operator console | `http://localhost:5173` from `pnpm dev:sepolia` | the same readers | Sepolia, through MetaMask's own RPC |

Registration runs on the operator console because only the laptop has the pin service. Handoffs and recall work from the operator console or from the hosted site, because they need only a wallet. The operator console also shows the dashboard lists from the Sepolia indexer in section 13.

Accounts on Sepolia. These are not Anvil keys, and Anvil keys are never used on Sepolia.

| Account | Roles | Funding |
| --- | --- | --- |
| A, `0xC369d193b2C6594da0dEB59C484D906F3F69CFAB` | admin, manufacturer, recall | holds the remaining test ETH |
| B, a new MetaMask account | none | about 0.003 Sepolia ETH from A |
| C, a new MetaMask account | none | about 0.003 Sepolia ETH from A |
| D, a new MetaMask account | none | about 0.003 Sepolia ETH from A, needed only if the rejected handoff is sent on-chain |

Preflight, before the session:

- The v2 contract is deployed, the roles are granted, `trusted-deployments.json` lists it, and the hosted site is built from the commit that lists it.
- A full rehearsal has run with a rehearsal batch code such as `PCB-2026-R01`. `PCB-2026-001` is kept for the live run, because a batch code can be registered only once per contract.
- A test pin reports `public: true`, and a phone on mobile data loads a rehearsal verification link.
- Balances of A, B, C, and D are checked.
- A screen recording of the full rehearsal, including the phone, is saved.

Sequence and what to say:

1. A registers `PCB-2026-001` on the operator console. The QR origin is the hosted site. After the receipt, show the QR. Say that the transaction carries the document and the contract computed its hash.
2. The audience scans it. The page shows a recognized deployment, how many independent readers agree at which block, the document as a match, the IPFS copy as a match, custodian A, and status active.
3. A proposes custody to B. B accepts. Refresh the phone. The timeline shows that handoff with its transaction.
4. B proposes custody to C. C accepts. The phone shows both handoffs and C as the current custodian.
5. D tries to propose a transfer. Before the wallet opens, the page shows the contract's own rejection, `NotCurrentCustodian`, from a simulation on a Sepolia node. Optionally send it anyway and open the reverted transaction on Etherscan. A disabled button is never a substitute for that revert.
6. On the phone, open "What would tampering look like?" and change the quantity from 50 to 500. The hash changes and the page says the edited document would not match the commitment. Say that this is a local simulation and that the record itself cannot be edited.
7. A recalls the batch with a short reason. The same QR now shows recalled and the reason.
8. Close with the independent path: run `pnpm verify-batch <url> --rpc <another node>` on the laptop, or open the contract on Etherscan. Say that nobody needs this website to check the record.

Say this limitation out loud: copying the sticker onto another box is possible. ProofChain checks the recorded story and who signed it.

Sepolia produces a block about every 12 seconds. Every write waits for at least one block. Narrate during the wait instead of clicking ahead.

### Fallback path: the local stack

The local stack is for development, for an offline rehearsal, and as the backup when Sepolia or the venue is unusable. It uses Anvil, chain id `31337`, and the same four-account sequence with Anvil's public development accounts in order: 0 is A, 1 is B, 2 is C, and 3 is D.

The dev server listens on `0.0.0.0:5173` and proxies same-origin paths. The manufacturer uses `http://localhost:5173` for the wallet, because a LAN IP over HTTP is not a secure context. MetaMask's Anvil network points at `http://127.0.0.1:8545` directly. Wallet writes do not go through the proxy.

| Browser path | Rule |
| --- | --- |
| `/rpc` | Read-only allowlist: `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getBlockByHash`, `eth_getCode`, `eth_call`, `eth_getLogs`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBalance`, `eth_gasPrice`, `eth_estimateGas`, `net_version`, `web3_clientVersion`. A body may be one call or an array of calls. Every element must have an allowlisted `method`. If any element is missing or disallowed, reject the whole request. Do not enable WebSocket proxying on `/rpc`. Upgrades skip body inspection. Reject `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_sign`, `personal_*`, and `anvil_*`. |
| `/ipfs/{cid}` | Proxied to the Kubo gateway. |
| `/api` | GET is proxied to the indexer. POST is proxied to the pin service only when both checks pass: the TCP peer address is loopback (`127.0.0.1`, `::1`, or `::ffff:127.0.0.1`), and the `Host` header is `localhost` or `127.0.0.1`, with an optional port. Either check failing rejects the request. A forged `Host: localhost` from a LAN address fails the peer check. A tunnel whose peer is loopback fails the Host check. |

A phone on the same network opens the QR with the laptop's LAN address typed into the QR-origin field. Classroom and hotel Wi-Fi often isolate clients, and on 30 October 2026 that already blocked the phone. If that happens, show the verification page in the laptop browser and play the recorded phone segment. Do not change the laptop's network configuration to work around it.

Switching four wallet accounts is part of the demo. Do not add a browser connector that signs as Anvil's unlocked accounts.

If the document cannot be read, the page still shows the on-chain custody, status, hashes, and transactions, and it shows the product document as unavailable. It does not invent the missing document. An attachment that fails to load does not by itself fail the document check. Only the canonical JSON bytes are the commitment.

## 5. Screens

| Route | Who | What it does |
| --- | --- | --- |
| `/` | anyone | One-sentence explanation, wallet connection, and a batch-code lookup that opens the verification URL for the write deployment. |
| `/register` | manufacturer wallet | The registration form, the simulation result, the pin result including whether a public copy exists, the receipt, then the QR download. On a build without a pin service it says that registration runs on the operator console. |
| `/custody` | connected wallet | Propose, accept, and cancel, each simulated first. Any connected wallet can submit a propose so an unauthorized account can be shown failing. |
| `/recall` | connected wallet | Recall, simulated first. Warn when the connected wallet lacks the role, and still surface the contract revert if they submit. |
| `/verify/:chainId/:contractAddress/:batchCode` | anyone, no wallet | Public verification. |

The dashboard information lives on `/`: connected address, network, roles held, batches related to that address, and pending handoffs. Those lists come from the indexer. The page shows the indexer's last processed block beside the chain head. Direct actions still work if the indexer is behind or down, and the lists say they are unavailable.

The verification page, top to bottom: the status line and seal, the reader agreement, the custody timeline, the product document with its two sources, the tamper simulation, the pending handoff, the recall, and "Check it yourself".

Visual direction: a verification instrument, not a token landing page. Light paper background, black text, monospace for addresses and hashes, one seal color used when a batch is recalled or a check fails. No gradient hero, no price chart, no generic three-card feature row. Addresses render as chips: the short form plus a color derived deterministically from the address, with the full address one tap away, so an audience can follow a wallet through the timeline without reading hex.

## 6. Nuances and trust assumptions

These are part of the product. Preserve them in the interface and the write-up.

1. **The chain records claims.** It shows what was submitted and which wallet signed it. A manufacturer can register a false description. The chain then preserves that false claim and attributes it. Physical inspection and real identity processes sit outside the system.
2. **A QR code is a pointer, not a seal on the object.** Someone can copy the label onto a different box. This version identifies a batch or package. It does not cryptographically bind each electronic component.
3. **The administrator is a trust point.** The admin grants and revokes `MANUFACTURER_ROLE` and `RECALL_ROLE`. The interesting claim is that ordinary participants cannot bypass handoff rules or rewrite confirmed history. It is not that nobody has a privileged role.
4. **The website and PostgreSQL are conveniences.** An auditor can ignore both and recompute the batch from the contract and its logs. If the indexer and the contract disagree, the contract is the record the demo defends.
5. **IPFS holds the copy and the attachments.** The commitment-bearing document is in the registration event. The IPFS copy and any attachment depend on pinning. The CID and the hash let a reader detect a swapped or missing file. They do not keep it online.
6. **The contract computes the commitment.** `metadataHash` is `keccak256` of the document bytes the registration carried, so the stored hash and the published document cannot disagree. The contract does not parse JSON, so the page still checks the canonical form and the batch code inside it. The CID is a separate claim about where a copy lives. A CID that points at other bytes shows as an IPFS copy mismatch and withholds the green seal.
7. **Metadata is not edited in place.** There is no update function. A correction is a new batch and, when appropriate, a recall of the old one. Confirmed registrations stay in the history.
8. **The contract is not upgradeable.** A wrong rule is fixed by deploying a new contract. Old QR links include the contract address, so they keep pointing at the contract they were printed for. The trusted-deployment list can contain every deployment, current and earlier.
9. **Pending custody is not a third lifecycle status.** A batch is active or recalled. Pending is a flag on an active batch.
10. **Registration does not invent a previous custodian.** On-chain history lists accepted handoffs only. Origin is the manufacturer address plus `createdAt`.
11. **Confidential data does not go on the public chain.** The product document is published in a public event and on IPFS. Names in the demo document are product and company claims the user chose to publish. Do not put personal data, secrets, or private commercial documents in it.
12. **A submitted transaction is not a registration.** The QR appears after a successful receipt.
13. **Account A holding two roles is a demo convenience.** The contract and the tests treat manufacturer and recall as different roles.
14. **Reorgs are real on a public network.** The indexer rewinds and replays. The contract does not implement its own reorg logic. Confirmation depth is an indexer setting.
15. **The public verification page reads Ethereum and IPFS even when the indexer is down.** Roles on the dashboard are read with `hasRole` on the contract. They are not read from PostgreSQL.
16. **A registered CID can disagree with the registered document.** The contract stores the CID and does not retrieve the file. Verification is where that disagreement becomes visible.
17. **Batch codes are case-sensitive.** `PCB-2026-001` and `pcb-2026-001` are different batches. The UI preserves the typed case.
18. **Custody history is unbounded in this version.** The demo has two hops. A long ping-pong between two custodians can grow the on-chain array. That limit belongs in the threat write-up. This version does not add a cap.
19. **The pin routes are an operator endpoint.** They are reached through the dev proxy on localhost. They are not a public pinning product. The size limits are 4096 bytes for the canonical document and 5 MB for the optional file. The Pinata key lives only in the pin service's environment.
20. **Proposals are public before acceptance.** Anyone can read a pending handoff. Only the named recipient can accept it. The same public record reveals who holds which batches and how often they move. That supplier graph is part of the threat write-up.
21. **Batch codes are a single global namespace.** The first successful registration owns `PCB-2026-001`. Another manufacturer cannot register that same code. The id stays `keccak256` of the code so a QR can name the batch without also naming a wallet. Squatting is a known property of this version.
22. **One admin key is a weak point.** That key can grant a manufacturer who then writes a false document. A multisig or a delayed admin transfer is future work. This version keeps OpenZeppelin `AccessControl` and a single admin.
23. **A green seal applies only to a trusted deployment.** Anyone can deploy a lookalike contract and print a QR for it. The page shows the green seal only when the chain id and contract address are in `trusted-deployments.json`. An unrecognized contract still shows the raw reads, with a hard warning and no green seal.
24. **Readers are windows, not the chain.** Each reader is one company's node. Agreement between independent readers at one block makes a single lying or broken provider visible. It is not proof: providers can share infrastructure or fail together. Running your own node, the CLI against a node you choose, and the storage-proof check in package 13 are stronger. On the local stack there is one reader, the laptop's `/rpc` proxy, and the page says so.
25. **The hosted site is a trust point.** Whoever controls it controls the code that draws the green seal. The CLI verifier, a `cast call`, and the block explorer are the independent paths. The hosted build sends a content security policy that limits which origins the page can contact.
26. **Sepolia repriced state creation on 6 October 2026.** On the upgrade Sepolia reports as active since 2026-10-06 13:53:36 UTC, deployed code costs about 1,542 gas per byte instead of 200, and a new storage slot about 111,000 gas instead of about 22,000. The version 1 deploy used 10,294,291 gas for 6,446 bytes of runtime code, about 96 percent of it code deposit, and a version 1 registration estimates at about 937,000 gas on Sepolia against about 230,000 on Anvil. Local simulations, including Forge's, do not know these rules: two creation attempts with Forge's limits ran out of gas before the third succeeded. Gas limits for Sepolia come from Sepolia's own `eth_estimateGas`. The base fee is a few dozen wei, so a small priority fee keeps the cost negligible.
27. **Old logs can expire.** Ethereum clients are allowed to drop old history. The contract's state (hash, custodian, status, history array) does not expire, but the document in the registration event does once readers stop serving those logs. The IPFS copy is the long-term backup for the document, and the page falls back to it.
28. **Gateways are interchangeable.** The page checks every fetched file against the on-chain hash, and a raw CIDv1 also against its own digest, so a gateway cannot substitute bytes without being caught. Pinata is an availability service, not a trust point.
29. **A simulation is a read.** A simulated rejection shows what the contract code does for that caller at that block. Only a sent transaction is part of the record.

## 7. Architecture

```text
Phone, no wallet
  opens the hosted site (static files only)
  asks every Sepolia reader in trusted-deployments.json for the record at one anchor block
  reads the batch's logs, including the document, from an agreeing reader
  fetches the IPFS copy and attachments from the configured gateways
  does not call /api to decide what is true

Laptop, operator console
  browser + MetaMask --writes--> Sepolia, through the wallet's RPC
  Vite dev server on 127.0.0.1:5173, mode sepolia
    POST /api -> pin service :8788   only from a loopback peer and a localhost Host
    GET  /api -> indexer-sepolia :8789
  pin service -> Kubo :5001 (local copy) and Pinata (public copy, server-side key)
  indexer-sepolia -> a public Sepolia reader -> PostgreSQL

Local fallback
  Anvil :8545, Kubo :5001/:8080, PostgreSQL :5432, indexer :8787, pin :8788
  Vite on 0.0.0.0:5173 with the /rpc, /ipfs, and /api rules in section 4
```

| Piece | Authority? | Role |
| --- | --- | --- |
| `ProductRegistry` | Yes, for custody, status, roles, and the commitment | Shared rules and state |
| Ethereum logs | Yes, for transaction hashes, the audit sequence, and the published document | Independent reconstruction |
| Readers | No | Windows onto the chain. Agreement is evidence, not proof |
| IPFS: Kubo, Pinata, gateways | No | The document copy and the attachments. Every byte is checked |
| Pin service | No | Checks the document, pins exact bytes, requires matching CIDs |
| PostgreSQL indexer | No | Searchable projection. Deduplicates logs, survives restarts, rewinds reorgs |
| Verifier library | No | The one implementation of the checks in sections 10 and 14 |
| Web app and hosted site | No | Wallet actions, QR generation, public verification |
| CLI verifier | No | A second client of the verifier library, for a node the reader chooses |

Environments. The write chain decides where the app writes and which deployment new QR codes name.

| Environment | Command | Write chain | Readers | Pin | Indexer |
| --- | --- | --- | --- | --- | --- |
| local | `pnpm dev` | Anvil `31337` | same-origin `/rpc` | Kubo, Pinata optional | `:8787` |
| operator | `pnpm dev:sepolia` | Sepolia `11155111` | the Sepolia readers | Kubo and Pinata, public copy required | `indexer-sepolia` `:8789` |
| hosted | `vite build --mode sepolia` on the host | Sepolia `11155111` | the Sepolia readers | none | none, lists say unavailable |

## 8. Tech stack

| Layer | Choice |
| --- | --- |
| Contract | Solidity 0.8.28, Foundry, optimizer on |
| Access control | OpenZeppelin Contracts 5.x `AccessControl`. Do not invent a second role system |
| Web | React, TypeScript, Vite |
| Chain client | Viem and Wagmi. Do not add a second wallet library |
| App data | TanStack Query, React Router |
| QR | Generated in the browser from the verification URL. PNG download |
| Metadata package | `@proofchain/metadata`, shared by the web app, the pin service, and the verifier |
| Verifier package | `@proofchain/verifier`, shared by the web app and the CLI |
| Indexer and pin API | TypeScript on Node, Hono, `pg` |
| Database | PostgreSQL 16 |
| Content storage | Kubo locally, Pinata for the public copy |
| Local chain | Anvil, chain id `31337`, port `8545` |
| Public demo chain | Sepolia, chain id `11155111` |
| Hosting | A static host. Vercel is the proposed host |
| Package manager | pnpm. The root `pnpm-lock.yaml` is the only lockfile |
| Tests | Foundry for contracts. `node:test` for every TypeScript package |

Do not add NFTs, a token, a marketplace, upgrade proxies, a relayer, or a custom consensus node.

## 9. Repository layout

The repository root is the workspace root. Do not wrap it in an extra `proofchain/` directory.

```text
MASTER_PLAN.md
README.md
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
scripts/check.mjs           the pnpm check gate
docker-compose.yml
.env.example
contracts/
  foundry.toml
  src/ProductRegistry.sol
  script/Deploy.s.sol
  test/ProductRegistry.t.sol
  test/ProductRegistryFuzz.t.sol
  test/ProductRegistryInvariant.t.sol
  lib/                      vendored forge-std and OpenZeppelin, not a nested repository
packages/metadata/
packages/verifier/
  src/
  test/
  bin/verify-batch.ts
services/pin/
apps/web/
  src/
  test/
  server/                   dev-server proxy and its policy
  trusted-deployments.json
  .env.sepolia              public values only
  vercel.json
indexer/
  src/
  test/
  migrations/
docs/threat-model.md
```

`README.md` tells a stranger what the project is, how to check a batch, and how to run the local stack and the demo. `docs/threat-model.md` is the academic trust write-up taken from section 6. Neither file becomes a second protocol specification, and neither links to this file.

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
- The published bytes are the UTF-8 bytes of that exact string.
- `metadataHash = keccak256` of those bytes. In Viem this is `keccak256(toBytes(canonical))`. In Solidity it is `keccak256(bytes(document))`.
- Unknown keys are rejected. A number typed as a string is rejected. `quantity` must be a JSON integer. `productionDate` must be a real calendar date in `YYYY-MM-DD`.
- Strings must already be trimmed. Do not trim before hashing.
- The canonical document is at most 4096 bytes, the same limit the contract enforces.

The shared `packages/metadata` module is the only off-chain implementation of this rule and of batch ids. It exports `canonicalize`, `hashMetadata`, `computeBatchId`, `validateBatchCode`, and `parseAndValidate`. The web app, the pin service, and the verifier import it. They do not reimplement the hash or the id.

### Golden vector

Canonical string, 234 bytes:

```text
{"batchCode":"PCB-2026-001","description":"","imageCid":"","manufacturerName":"Demo Electronics Pvt. Ltd.","name":"STM32 Controller Development Board","productionDate":"2026-10-15","quantity":50,"schemaVersion":1,"sku":"CTRL-STM32-A"}
```

Computed with Viem 2.57.13:

```text
batchId       0x9d6be2557c721891700c118158cc27ec51fd21cd40d2b73a7670b7e1466936d2
metadataHash  0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752
CID           bafkreicjx37puhth4lglmhqqna5gjrcvjedfpputssey6isdy5slgiz7im   (Kubo, cid-version=1)
```

`batchId = keccak256` of the UTF-8 batch code `PCB-2026-001`. The metadata package tests reproduce both hashes. The pin service test with a real Kubo, and the Pinata live check, reproduce the CID. Changing the key set, key order, or whitespace changes the vector on purpose.

### Pinning

`POST /blobs` accepts raw file bytes, up to 5 MB, and returns `{ "cid", "public" }`. An empty body is rejected. The client puts that CID into `imageCid` before hashing the document.

`POST /metadata` accepts:

```json
{ "canonical": "<json string>", "batchCode": "PCB-2026-001" }
```

The service parses the string, validates the schema, recomputes the canonical string, and rejects the request when the recomputed string differs from the submitted string or when `batchCode` differs from the code inside the JSON. It then pins the exact submitted bytes and returns:

```json
{ "cid": "bafk...", "metadataHash": "0x...", "public": true }
```

Pin targets:

- Kubo is always first: `IPFS_API_URL`, `cid-version=1`, `pin=true`. Inside Compose that is `http://ipfs:5001`. From the host it is `http://127.0.0.1:5001`.
- When `PINATA_JWT` is set, the service also uploads the same bytes to Pinata's public network. The CID Pinata reports must equal Kubo's CID. If it differs, the request fails with `CidMismatch` and returns no CID.
- `PIN_REQUIRE_PUBLIC` defaults to `true` when `PINATA_JWT` is set. Then a Pinata failure fails the request with `PinFailed`. With `PIN_REQUIRE_PUBLIC=false`, a Pinata failure returns `public: false` instead. Without `PINATA_JWT`, every response is `public: false`.
- The key never appears in a response, a log line, or the browser.
- The service reads only its own variables (`PORT`, `PIN_HOST`, `IPFS_API_URL`, `PINATA_JWT`, `PIN_REQUIRE_PUBLIC`, `PINATA_API_URL`) from the root `.env`, so `pnpm pin` picks up the key while `PRIVATE_KEY` never reaches the process. The process environment wins over the file. For offline local work, set `PIN_REQUIRE_PUBLIC=false`.

Errors stay `{ "error", "message" }`. The client signs `registerBatch` only when the returned `metadataHash` equals the hash it computed locally. The browser does not call Kubo or Pinata directly. The pin service does not import the indexer and does not open Postgres. The app does not recompute a CID for pinning. The CID is the retrieval key. The keccak commitment is the integrity check.

### Verification of a document

The document has two sources.

The **on-chain document** is the `document` field of the batch's `BatchRegistered` log. **Match** requires all of these:

1. `keccak256` of its UTF-8 bytes equals the `metadataHash` that `getBatch` returns at the anchor block.
2. Re-canonicalizing the parsed JSON produces those same bytes.
3. `batchCode` inside the JSON equals the batch code in the URL.
4. `computeBatchId` of that batch code equals the id used to read the contract.

The **IPFS copy** is fetched by the stored `metadataCid` from each configured gateway in order. A copy passes when `keccak256` of the fetched bytes equals `metadataHash`, and, when the CID is CIDv1 with the raw codec and sha2-256, when `sha256` of the bytes equals the CID's digest. Other CID forms are reported as "CID not checked". The first gateway whose bytes pass ends the search. If some gateway returned bytes and none passed, the copy is a mismatch. If no gateway returned bytes, the copy is unavailable.

The document verdict:

- **Match** when the on-chain document passes. When the logs could not be loaded, the IPFS copy can stand in, and then it must pass checks 1 through 4 on its own bytes.
- **Mismatch** when a source was read and failed.
- **Unavailable** when neither source could be read.

Chain custody, status, hashes, and transactions render in every case. The page does not replace them with indexer fields.

## 11. QR codes

The QR payload is an absolute URL:

```text
{origin}/verify/{chainId}/{contractAddress}/{batchCode}
```

The image is generated in the browser after a successful registration receipt. It is not stored on Ethereum, on IPFS, or in PostgreSQL. The same URL can be turned back into a QR image at any time. A downloaded PNG is a convenience for printing.

The default origin is the QR-origin field on the registration screen. That field starts as `VITE_PUBLIC_ORIGIN` when set, which in operator mode is the hosted site, and otherwise as the page origin. The contract address in the path is EIP-55 checksummed. The page accepts any hex case for that address. If the encoded origin is `localhost` or `127.0.0.1`, the registration confirmation warns that a phone cannot open it.

Batch codes are case-sensitive and URL-safe by the contract rule in section 12, so the code is a single path segment and is not lowercased.

## 12. Contract

File: `contracts/src/ProductRegistry.sol`. This section is version 2. The custody protocol is unchanged from version 1. Only registration changed: the document travels in the transaction and the contract computes the commitment.

The contract inherits OpenZeppelin `AccessControl`. It has no external calls, so it does not need a reentrancy guard. It is not upgradeable and it cannot be paused.

### Roles

```text
DEFAULT_ADMIN_ROLE   OpenZeppelin admin. Grants and revokes the two roles below.
MANUFACTURER_ROLE    keccak256("MANUFACTURER_ROLE")
RECALL_ROLE          keccak256("RECALL_ROLE")
```

Constructor: `constructor(address admin)`. `admin` receives `DEFAULT_ADMIN_ROLE`. Address zero reverts `ZeroAddress`. `ZeroAddress` is used for nothing else.

Distributors and retailers have no role. Being the named recipient is the only authority required to accept a handoff.

Use `onlyRole(MANUFACTURER_ROLE)` on `registerBatch` only. That modifier runs before the function body, so an unauthorized caller gets `AccessControlUnauthorizedAccount` even when the batch code is already taken. `recallBatch` does not use the modifier. It calls `_checkRole(RECALL_ROLE, msg.sender)` after the existence and status checks below.

### Constants

```solidity
uint256 public constant MAX_BATCH_CODE_LENGTH = 64;
uint256 public constant MAX_DOCUMENT_LENGTH = 4096;
uint256 public constant MAX_CID_LENGTH = 128;
uint256 public constant MAX_REASON_LENGTH = 128;
```

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

The structs are unchanged from version 1, so `getBatch`, `getPendingTransfer`, and `getCustodyHistory` keep their ABI. `Status.None` is unset storage. Existence is `status != Status.None`. There is no second `exists` flag. A successful `getBatch` returns `Active` or `Recalled`.

### Functions

```solidity
function computeBatchId(string calldata batchCode) external pure returns (bytes32);

function registerBatch(
    string calldata batchCode,
    string calldata document,
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

Checks, in this order:

1. Caller has `MANUFACTURER_ROLE`, through the modifier.
2. `batchCode` length is 1 through 64, and every character is `A-Z`, `a-z`, `0-9`, or `-`. Otherwise `InvalidBatchCode`.
3. `batchId = keccak256(bytes(batchCode))` is not already registered. Otherwise `BatchAlreadyExists(batchId)`.
4. `document` length is 1 through 4096 bytes. Otherwise `InvalidMetadata`. The contract does not parse the document.
5. `metadataCid` length is 1 through 128, and every character is printable ASCII from `0x21` through `0x7E`. Otherwise `InvalidMetadata`.

Effects:

- `metadataHash = keccak256(bytes(document))`.
- Manufacturer and current custodian are both `msg.sender`.
- Status is `Active`. `createdAt` is `uint64(block.timestamp)`.
- No pending transfer. History is empty.
- Store `batchCode` so a log reader can recover the human code.
- The document itself is not stored in contract storage. It is emitted in `BatchRegistered`.

### `proposeCustodyTransfer`

- The batch exists and is `Active`.
- `msg.sender` is `currentCustodian`.
- No pending transfer is active.
- `to` is not the zero address and is not the current custodian. Otherwise `InvalidRecipient(to)`.
- Pending becomes active, with `from = msg.sender`, `to = to`, and `proposedAt = uint64(block.timestamp)`.

### `cancelCustodyTransfer`

- The batch exists and is `Active`.
- `msg.sender` is the current custodian.
- A pending transfer is active.
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
- Status becomes `Recalled`. The reason is stored in the event, not as a second status. Recall is irreversible.

### Reads

- `getBatch` and `getCustodyHistory` revert when the batch does not exist. An existing batch may have an empty history.
- `getCustodyHistory` returns accepted handoffs oldest first.
- `getPendingTransfer` reverts when the batch does not exist. When the batch exists and nothing is pending, it returns `active = false` and zeroed fields.
- Clearing a pending transfer sets `active` to false and sets `from`, `to`, and `proposedAt` to zero.

### Check order

For `proposeCustodyTransfer` and `cancelCustodyTransfer`:

1. `BatchNotFound` when the batch does not exist.
2. `AlreadyRecalled` when the status is not `Active`.
3. `NotCurrentCustodian` when the caller is not the custodian.
4. Then the pending checks for that function.

For `acceptCustodyTransfer`:

1. `BatchNotFound`.
2. `AlreadyRecalled`.
3. `NoPendingTransfer` when nothing is pending.
4. `NotPendingRecipient` when the caller is not the named recipient.

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

`InvalidMetadata` covers a document outside 1 through 4096 bytes and a CID that fails the length or character rule.

### Events

```solidity
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

event CustodyTransferCancelled(bytes32 indexed batchId, address indexed from, address indexed to, uint64 cancelledAt);

event CustodyTransferred(bytes32 indexed batchId, address indexed from, address indexed to, uint64 timestamp);

event BatchRecalled(
    bytes32 indexed batchId,
    address indexed recalledBy,
    bool pendingCleared,
    uint64 recalledAt,
    string reason
);
```

`BatchRegistered` gained `document` as its last field, so its topic differs from version 1. The other four events are unchanged. Emit the matching event after the state write succeeds. `CustodyTransferCancelled.cancelledAt` and `BatchRecalled.recalledAt` are `uint64(block.timestamp)`.

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
- `metadataHash` and `metadataCid` never change.
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

It deploys `ProductRegistry(ADMIN_ADDRESS)` and grants the manufacturer and recall roles. It reverts with `AdminKeyMismatch(address,address)` unless `vm.addr(PRIVATE_KEY)` equals `ADMIN_ADDRESS`, because only the admin can grant those roles in the same script. For a local solo demo, the manufacturer and recaller addresses may be the same account. The script prints the contract address.

On Sepolia, every gas limit comes from Sepolia's own `eth_estimateGas` with a margin, never from Forge's local simulation. Record the estimate, the gas used, the block, and the transaction hash of each step.

The README may quote the keys Anvil prints and must label them as public development keys that are never used on Sepolia or mainnet. Never commit a private key or a filled `.env`.

### Contract tests

`ProductRegistry.t.sol` covers the successful path and a revert for every rejected transition in this section, including duplicate batch codes, bad batch-code characters, an empty document, a 4097-byte document, a 4096-byte document that succeeds, an empty CID, a CID longer than 128 characters, the check order between the document and the CID, a zero recipient, a self-handoff, a second proposal, accept and cancel by the wrong wallet, recall clearing a pending handoff, a second recall, a reason longer than 128 bytes, an empty reason, and the recall check order. It asserts that the stored hash is `keccak256` of the document and that the golden document yields the golden hash. Every one of the five events is asserted with `expectEmit` on all fields, because the indexer and the verifier decode them.

`ProductRegistryFuzz.t.sol` fuzzes unauthorized callers for register, recall, propose, accept, and cancel, as in version 1, and fuzzes document lengths across the 4096 boundary.

`ProductRegistryInvariant.t.sol` drives a handler that holds the roles and an actor set that includes a stranger. Each handler action picks its caller from that set, so unauthorized attempts are part of the sequence. The handler catches expected reverts. The invariant assertions are the list in this section. Use at least 64 runs and depth 32.

`forge test` passes and `forge fmt --check` is clean before the package is done.

## 13. Indexer

The indexer is a derived projection of one contract's logs. It is rebuilt from those logs after a restart or a reorg. It runs on the laptop. It is not hosted.

### Configuration

| Variable | Local default |
| --- | --- |
| `DATABASE_URL` | `postgres://proofchain:proofchain@127.0.0.1:5432/proofchain` |
| `CHAIN_RPC_URL` | `http://127.0.0.1:8545` |
| `CHAIN_ID` | `31337` |
| `CONTRACT_ADDRESS` | deployment output |
| `START_BLOCK` | deployment block |
| `CONFIRMATIONS` | `0` on Anvil, `2` when `CHAIN_ID` is `11155111` |
| `REORG_WINDOW` | `64` |
| `LOG_RANGE` | `50000`, halved on a range rejection or timeout |
| `IPFS_API_URL` | `http://127.0.0.1:5001` on the host, `http://ipfs:5001` inside Compose |
| `INDEXER_HOST` | `127.0.0.1` |
| `INDEXER_PORT` | `8787`. The Sepolia indexer uses `8789` |
| `WEB_ORIGIN` | the Vite origin, for CORS |
| `PIN_URL` | `http://127.0.0.1:8788` |
| `POLL_INTERVAL_MS` | `2000` |

The Compose indexer overrides `CHAIN_RPC_URL` to `http://anvil:8545` and `DATABASE_URL` to the `postgres` service. Using `127.0.0.1` inside a container points at the container itself.

The local database password is a development default, not a production secret. It still lives in `.env`, not in source.

`indexer_meta` records the chain id, contract address, and start block of the first successful start. If the environment later disagrees, the process refuses to run. A resync does not silently switch chains. Changing contract or chain means an empty database, which is why the Sepolia indexer uses its own database.

### Tables

`indexer_meta` is a single row: `chain_id`, `contract_address`, `start_block`, `start_block_hash`, `last_processed_block`, `last_processed_hash`.

`blocks`: `number` primary key, `hash`, `parent_hash`.

`logs`: `block_number`, `block_hash`, `tx_hash`, `log_index`, `event_name`, `payload` JSON, `applied` boolean. Primary key `(tx_hash, log_index)`.

`batches`: `batch_id` primary key, `batch_code` unique, `manufacturer`, `current_custodian`, `metadata_hash`, `metadata_cid`, `status` (`active` or `recalled`), `created_at`, `created_block`, `created_tx`, `recalled_at`, `recalled_block`, `recalled_tx`, `recall_pending_cleared`, `recall_reason`.

`pending_transfers`: `batch_id` primary key, `from_address`, `to_address`, `proposed_at`, `proposed_block`, `proposed_tx`. A row exists only while the handoff is pending.

`custody_transfers`: `batch_id`, `from_address`, `to_address`, `accepted_at`, `block_number`, `tx_hash`, `log_index`. Unique `(tx_hash, log_index)`.

Store addresses in lowercase hex. Store hashes with the `0x` prefix. Store batch ids as `0x` plus 64 hex characters. The document from `BatchRegistered` stays in the log payload. It is not a column.

### Sync

1. If `indexer_meta` is missing, the cursor is empty and the first scanned block is `START_BLOCK`, inclusive. Block 0 is a legal deployment block.
2. If the chain head is below `CONFIRMATIONS`, wait. Otherwise `safeHead` is head minus `CONFIRMATIONS`. Blocks above `safeHead` stay out of the database.
3. Headers stored: the header at `START_BLOCK`, the header of every block that contains a product log, and the headers of the last `REORG_WINDOW` blocks up to `safeHead`. Older window headers that carry no product log may be deleted. On the first stored header, save its hash as `start_block_hash`.
4. Process from the cursor to `safeHead` in ranges of at most `LOG_RANGE` blocks. For each range: fetch the five product event topics from the contract, fetch the headers rule 3 requires, check that each log's block hash equals its header, insert with `ON CONFLICT DO NOTHING`, apply, advance the cursor, and commit. Each range is its own database transaction, so a failure keeps the progress of earlier ranges. Ignore `RoleGranted`, `RoleRevoked`, and any other topic. A log that claims to be one of the five events and then fails to decode pauses the sync loop and sets `syncOk` to false. It does not exit the process.
5. On every tick, before ingesting: if the node reports a different hash at `START_BLOCK`, or cannot find `last_processed_block` because the chain was reset, truncate the indexer tables and start again. That is the expected result of restarting Anvil against a persisted Postgres volume. If the stored hash at `last_processed_block` differs from the node's, walk the stored headers downward until one matches. That height is the common ancestor. Delete blocks and logs above it, delete every projection row, mark the remaining logs unapplied, replay them in `(block_number, log_index)` order, and re-ingest from the ancestor. If no stored header matches, truncate and start again at `START_BLOCK`.
6. Apply logs where `applied = false`, in `(block_number, log_index)` order. Then set `applied = true`. Projection timestamps come from the event arguments, converted from Unix seconds. They do not come from the indexer's wall clock.
7. Poll about every 2 seconds. A restart continues from `indexer_meta`. If the RPC is down, keep the process alive and report the failure on `/health`.
8. A resync command truncates the indexer tables and runs the loop from `START_BLOCK` again.

Applying a log twice does not create a second handoff or a second batch. Projection code uses the primary keys above.

`BatchRegistered` inserts a batch. `CustodyTransferProposed` inserts a pending row. `CustodyTransferCancelled` deletes it. `CustodyTransferred` updates the custodian, deletes the pending row, and inserts history in oldest-first order. `BatchRecalled` sets recalled fields, stores `reason`, and deletes any pending row. `pendingCleared` is stored so it can be shown.

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

When the RPC is unreachable or sync is paused, `syncOk` is false, `ok` is false, and `headBlock` may be null. `lastProcessedBlock` is still reported. `pinOk` reports whether this process can see the pin service.

`GET /batches?participant=0x...&status=active&q=PCB`

`q` matches a batch-code prefix, preserving case, or a full address. `participant` matches the manufacturer, the current custodian, or the pending recipient, so account A still sees a batch after handing it to B. `status` is `active` or `recalled`.

`GET /batches/:batchKey` treats a key of `0x` plus 64 hex characters as a batch id. Every shorter key is a case-sensitive batch code. The response is:

```json
{
  "batchId": "0x9d6b…",
  "batchCode": "PCB-2026-001",
  "manufacturer": "0x…",
  "currentCustodian": "0x…",
  "metadataHash": "0x…",
  "metadataCid": "bafk…",
  "status": "active",
  "createdAt": "2026-10-29T12:00:00.000Z",
  "createdBlock": "1",
  "createdTx": "0x…",
  "recalledAt": null,
  "recallReason": null,
  "recallPendingCleared": null,
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

### Indexer tests

Unit tests, with no Docker, cover:

- Applying the five events in order produces the registration, one pending handoff, an accepted handoff, and a recall that clears a pending handoff.
- Applying the same log twice does not duplicate history.
- A reorg that replaces the tip removes the dropped logs and the projection built from them, then replay restores the surviving history.
- A reorg deeper than the stored headers truncates and starts again.
- A stored start-block hash that no longer matches the node truncates the projection and starts again.
- A catch-up across 100,000 blocks with three product logs fetches headers only for those blocks, the start block, and the window, and commits per range. A failure in a later range keeps the earlier ranges.
- A range rejection halves the range and continues.

Live checks, which the 30 October audit already ran once against version 1 with a throwaway Postgres: sync a local chain; trigger `anvil_reorg` and confirm the replaced batch disappears; restart Anvil under a persisted database and confirm the truncate and resync; stop the RPC and confirm the process survives. Repeat them for version 2, then run one catch-up against Sepolia from the v2 deployment block.

## 14. Web application

### Configuration

`apps/web/trusted-deployments.json`:

```json
{
  "deployments": [
    {
      "chainId": 31337,
      "address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      "startBlock": 1,
      "label": "local anvil",
      "current": true,
      "rpcUrls": []
    },
    {
      "chainId": 11155111,
      "address": "0x<v2 address>",
      "startBlock": 0,
      "label": "sepolia",
      "current": true,
      "rpcUrls": [
        "https://ethereum-sepolia-rpc.publicnode.com",
        "https://1rpc.io/sepolia",
        "https://sepolia.gateway.tenderly.co",
        "https://sepolia.rpc.thirdweb.com",
        "https://0xrpc.io/sep"
      ]
    }
  ]
}
```

- `current: true` marks the newest deployment on its own chain. At most one entry per chain is current. A file with two current entries on one chain is a configuration error that the app reports and the test suite rejects. Older entries stay with `current: false` so printed labels keep verifying. Address comparison is case-insensitive.
- `rpcUrls` are keyless public readers that answer browser requests. An empty list means same-origin `/rpc`, which exists only on the dev server. A build that finds no reader for a chain shows "This site cannot read chain N".
- `VITE_WRITE_CHAIN_ID` selects the write chain: where wallet writes go and which deployment new QR codes name. The local mode defaults to `31337`. `apps/web/.env.sepolia` sets `11155111`. A production build without a write chain says that writing is not configured, and verification still works.
- `VITE_IPFS_GATEWAYS` is a comma-separated list of gateway origins. Empty means same-origin `/ipfs`, which exists only on the dev server. The hosted build lists the Pinata dedicated gateway and then `https://gateway.pinata.cloud`.
- `VITE_PUBLIC_ORIGIN` prefills the QR-origin field. `VITE_INDEXER_URL` empty means same-origin `/api`.
- Dev-server only, never read by client code: `RPC_URL`, `PIN_URL`, `INDEXER_URL`, `IPFS_GATEWAY_URL`, `ALLOWED_HOSTS`. The dev server keeps Vite's host check on and adds only the names in `ALLOWED_HOSTS`, for a tunnel. LAN IP addresses and localhost pass Vite's check without being listed.
- `pnpm dev` runs the local mode on `0.0.0.0:5173`. `pnpm dev:sepolia` runs the operator mode on `127.0.0.1:5173`, because the operator console never needs the LAN.
- `apps/web/.env.sepolia` is committed and holds public values only. No file read by the client holds a secret. A secret RPC key is never committed and never placed in a `VITE_` variable. `VITE_CONTRACT_ADDRESS` is removed. The trusted-deployment list is the only source of contract addresses for the web app.

The ABI imported by the app is the ABI produced by `forge build`. `apps/web/src/contracts/ProductRegistry.ts` is generated from it by `pnpm --dir apps/web generate:abi`. Do not hand-edit it. The web app reads version 2 contracts only. No version 1 deployment with a registered batch remains on the trusted list.

### Reader agreement

The verifier library runs this for every verification:

1. Ask every reader for `eth_chainId` and `eth_blockNumber`, in parallel, with a timeout of about 8 seconds each. A reader that does not answer is unreachable. A reader that reports another chain id is listed as misconfigured and takes no further part.
2. The anchor block is the lowest head among the readers that answered.
3. Ask each of those readers, at the anchor block, for the block hash, `getBatch`, `getPendingTransfer`, `getCustodyHistory`, and `hasRole(MANUFACTURER_ROLE, manufacturer)`.
4. Compare the answers exactly. Readers that match the majority agree. A reader with any different answer disagrees, and the page shows what it returned.
5. Read the batch's logs from the first agreeing reader, falling back to the next one on failure. The filter is the contract address, the five product event topics, and the batch id as the first indexed topic, from the deployment's `startBlock` to the anchor block. Ranges start at 50,000 blocks and halve on a range rejection or a timeout. If no reader returns the logs, custody history comes from `getCustodyHistory`, transaction hashes are marked unavailable, and the document falls back to the IPFS copy.

Agreement holds when the agreeing readers number at least two, or one when only one reader is configured, and no reader disagrees. With no reachable reader, the page shows that the site's readers did not respond. It does not show the batch as found.

### Behavior worth preserving

- The chain id in the URL must match each reader's `eth_chainId`. A Sepolia label opened on a build that cannot read Sepolia shows that this site cannot read that chain.
- If the chain id and address are not in `trusted-deployments.json`, the page shows a hard warning that this is not a recognized deployment and does not show a green seal. It still shows the raw reads, using any reader configured for that chain.
- A recognized earlier deployment shows the data and says it is an earlier contract, with the current address on that chain beside it.
- The company name is labeled as claimed in the document. The registering wallet is shown separately, with the live manufacturer-role result.
- The green seal requires a trusted deployment, a document match, an IPFS copy that is not a mismatch, and agreement. The seal text says it covers the document and the agreement, and that recall status is separate.
- It shows on-chain custody even when IPFS is down, and when the logs are down.
- It shows the recall reason when one was given.
- It shows a warning when `getCustodyHistory` and the `CustodyTransferred` logs disagree in count or order.
- It does not read PostgreSQL.
- A batch that is not registered shows "No batch with code X is registered on this contract", with the raw contract error below it.
- The custody timeline lists registration, each proposal, cancellation, accepted handoff, and the recall, oldest first, each with its block, time, and transaction, and the pending handoff as an open step.
- The tamper simulation starts from the on-chain document, lets the reader edit it, recomputes `keccak256` live, and shows whether the edited bytes would match the commitment. It is labeled as a local simulation that changes nothing.
- "Check it yourself" shows a working `cast call` and the CLI command, both with a node URL the reader replaces. The `cast` return signature is the tuple `"getBatch(bytes32)((string,address,address,bytes32,string,uint8,uint64))"`. On chain id `11155111` it links the contract and each transaction to `https://sepolia.etherscan.io`.
- Before a write, the app checks that the wallet chain id equals the write chain and requests a switch when it does not. Then it simulates the call as the connected wallet through a reader, and only then opens the wallet, as section 3 describes.
- Registration shows the QR only after a successful receipt, with the batch code, the checksummed contract address, the metadata hash, the CID, whether the copy is public, and the transaction hash.
- Custody and recall display the contract error text when a call reverts. Recall sends a reason string, or an empty string when the field is blank.
- Wallet connection is required for actions. The verification route does not connect a wallet and does not prompt for one.
- Dashboard lists use `/api`. Roles use `hasRole` on the contract.

### Verifier library and CLI

`packages/verifier` holds the verification logic: trust classification, reader agreement, log loading, document judgement, the IPFS copy check, and the timeline model. It does not read `import.meta.env` and does not touch the DOM. Its inputs are the chain id, contract address, batch code, deployment list, readers, gateways, and a `fetch` implementation. Its output is the verification result the page renders. The web app passes it the browser's configuration. The CLI passes it command-line options.

`pnpm verify-batch <verification-url> [--rpc <url>]... [--gateway <url>]...` prints the deployment trust, the agreement with each reader's result, the custody sequence, each document check, and the verdict. Without `--rpc` it uses the readers in `trusted-deployments.json`. It exits 0 only for a green-seal result.

### Hosted build

`apps/web/vercel.json` rewrites every path that is not a file to `index.html`, so `/verify/...` loads. It sets a content security policy whose `connect-src` lists only the configured readers and gateways, plus `X-Content-Type-Options: nosniff` and a strict referrer policy. The build command is `vite build --mode sepolia`. The host's environment sets `VITE_PUBLIC_ORIGIN` and `VITE_IPFS_GATEWAYS`. Nothing else is configured there.

The built bundle must not contain `PRIVATE_KEY`, `PINATA`, `RPC_URL`, `PIN_URL`, or any known Anvil development key. Served from a static server with no proxy, the verification page must contact only the configured readers and gateways, which the 30 October audit confirmed for version 1 by listing the page's network requests.

## 15. Local stack and deployment

`docker-compose.yml` runs:

| Service | Host publish | Notes |
| --- | --- | --- |
| `anvil` | `127.0.0.1:8545` | Foundry image at a pinned tag, `anvil --host 0.0.0.0 --port 8545 --chain-id 31337`. Automine stays on. Inside Compose the RPC is `http://anvil:8545`. |
| `postgres` | `127.0.0.1:5432` | `postgres:16-alpine`. User, password, and database `proofchain`. An init script also creates `proofchain_sepolia`. A volume keeps the index across restarts. |
| `ipfs` | `127.0.0.1:5001` and `127.0.0.1:8080` | Kubo at a pinned tag. |
| `pin` | `127.0.0.1:8788` | `services/pin`, built at image build time. Talks to Kubo and, when `PINATA_JWT` is set, Pinata. No Postgres. |
| `indexer` | `127.0.0.1:8787` | `indexer/`, built at image build time with a frozen lockfile. Nothing is installed when the container starts. Calls `http://anvil:8545`. |
| `indexer-sepolia` | `127.0.0.1:8789` | Profile `sepolia`. Same image. Database `proofchain_sepolia`, `CHAIN_ID=11155111`, `CONFIRMATIONS=2`, a public Sepolia reader as `CHAIN_RPC_URL`, and the v2 deployment block as `START_BLOCK`. |

Publishing those ports on localhost keeps the pin API off the LAN. No image uses the `latest` tag.

The web app runs on the host with `pnpm dev` or `pnpm dev:sepolia`, so UI work stays fast.

Local contract deployment uses the Foundry script against Anvil. On a fresh Anvil the first contract from account 0 is `0x5FbDB2315678afecb367f032d93F642f64180aa3`, which the local trusted entry already names. Restarting Anvil discards its chain. Redeploy, and the indexer resyncs by itself.

Sepolia deployment, only with Harsha's yes at the time: estimate the creation and each role grant with Sepolia's `eth_estimateGas`; deploy with those limits plus a margin and a small priority fee; grant the roles; record the address, block, transactions, estimates, and gas used in section 19; update the Sepolia entry in `trusted-deployments.json`; and remove the version 1 Sepolia entry, which never registered a batch. Test ETH only. Do not deploy to mainnet. Do not invent a funded key.

Hosting, only with Harsha's yes at the time: a Vercel project, or another static host, serving `apps/web` built with `--mode sepolia`, with the settings in section 14. The host never receives a secret.

`.env.example` lists every variable in this plan with empty secrets and the local defaults for non-secrets, including `PINATA_JWT=` and `PIN_REQUIRE_PUBLIC=`.

If the Docker daemon is not running and starting it needs a password, stop and ask. Do not start containers that belong to other projects, such as `surf_brothers_db` from `/home/harsha/Projects/Surf Brothers`. Pure unit tests do not require Docker.

## 16. Security and assurance

Contract tests are the first assurance. They must fail closed on every rejected transition in section 12. The invariant suite is the second. It exists to catch a sequence the unit tests did not name, especially a recalled batch becoming active or a custodian changing without an acceptance.

`pnpm check` at the repository root is the test gate, and it runs before every push: `forge fmt --check`, `forge build`, `forge test`, every Node test suite, the web type-check, a production build into a temporary directory, and a scan of that bundle for the strings section 14 forbids. It exits non-zero on the first failure. There is no GitHub Actions workflow, by Harsha's decision.

Run Slither 0.11.6 against `contracts/` after the version 2 contract lands and record the result in `docs/threat-model.md`, including any finding that is accepted and why. The command is `uvx --python 3.12 --from slither-analyzer==0.11.6 slither . --filter-paths lib` from `contracts/`. It runs `forge clean`, so rebuild afterwards. A tool that cannot be installed is recorded as a gap, not treated as a pass.

Threat model to write in `docs/threat-model.md`, in the project's own words:

- What an external account can try, and which error stops it.
- What the admin can do, including granting a manufacturer who then registers a false document.
- What a current custodian can do, including proposing a handoff to an address that never accepts, and cancelling that proposal.
- What a manufacturer can do by registering a CID that does not point at the document, and how the page shows the IPFS copy mismatch.
- What IPFS pinning loss and log expiry look like to a reader.
- What a copied QR label does and does not prove.
- What the indexer can get wrong during downtime or a reorg, and why the public page has a direct Ethereum path.
- What readers can get wrong, what agreement shows, and what it does not show.
- That the hosted site controls the code that draws the seal, and which paths are independent of it.
- That pending handoffs are visible before the recipient accepts, and that the public record reveals a supplier graph.
- That batch codes are a global namespace and the first manufacturer to register a code owns it.
- That one admin key can appoint a manufacturer.
- That a lookalike contract can print a QR, and the green seal is limited to the trusted-deployment list.
- That custody history is unbounded in this version.
- Who pays gas, what each action cost on Sepolia after the October 2026 repricing, measured, and why local estimates were wrong.

The web app has automated checks for a reverted receipt, a simulated rejection, an RPC error, every reader unreachable, a disagreeing reader, an unreachable gateway, a gateway that returns wrong bytes followed by one that returns the right bytes, and the `cast` signature decoding a real `getBatch` return. The page shows those failures. It does not show a successful registration when the receipt failed.

## 17. README and write-up

The README opens with the one-sentence definition from section 1, then the limitation about physical goods and copied labels, then a live verification link on Sepolia and how to check it without the website, then the costs measured on Sepolia, then how to run the local stack, then the demo sequence from section 4. It links to `docs/threat-model.md` for the trust write-up. It reads like a public project page. It does not link to this file, and it does not narrate how the project was built.

## 18. Work packages

Phase 1, accepted: package 1 contract, package 2 metadata and pin, package 3 web application, package 4 indexer, and the integration files.

Packages run in parallel only where their files do not overlap. Each package is done when its criteria pass, verified by the orchestrator re-running them. Shared files have one owner per wave. Steps that need Harsha are listed in section 0, and an executor stops at them instead of inventing a way around them.

### Wave 1, in parallel

**Package 5. Contract v2, its callers, and the environment fix.** Owns `contracts/src`, `contracts/test`, `contracts/script`, `packages/metadata`, `apps/web/src`, `apps/web/scripts`, `apps/web/test`, `apps/web/vite.config.ts`, `apps/web/trusted-deployments.json`, `apps/web/.env.sepolia`, `apps/web/package.json`, `indexer/src/events.ts`, `indexer/src/apply.ts`, `indexer/test`, `.env.example`, the `.gitignore` exception for `apps/web/.env.sepolia`, and the `dev` and `dev:sepolia` scripts in the root `package.json`.

Implement section 12, run `forge fmt`, and regenerate the ABI. Adapt the direct callers: registration passes the canonical document, the metadata limit becomes 4096 bytes, and the indexer decodes the new `BatchRegistered`. Implement the configuration in section 14: the per-chain `current` rule, `rpcUrls` as a list with the five Sepolia readers on the existing Sepolia entry, `VITE_WRITE_CHAIN_ID`, the two Vite modes, the removal of `VITE_CONTRACT_ADDRESS`, Vite's host check with `ALLOWED_HOSTS`, and the tuple `cast` signature with a test that decodes a real return. Until package 8 lands, the reader uses the first reader in the list. Restart the local Anvil, redeploy, register the golden document with `cast` after pinning it through the running pin service, and confirm that the local verification page shows Match.

Done when `forge test` and `forge fmt --check` pass, `pnpm test` passes, the web app type-checks and builds, the golden id and hash are unchanged, the local verification page shows Match for the v2 registration, the local entry is no longer labeled an earlier contract, and `cast estimate --create` for the v2 creation code against Sepolia is recorded without sending a transaction.

**Package 6. Pin service with a public copy.** Owns `services/pin`. Implement the pin targets in section 10 behind the existing `Pinner` interface: Kubo first, then Pinata's public upload, identical CIDs required, `PIN_REQUIRE_PUBLIC`, and `public` in every response. Check Pinata's current upload API in its documentation rather than from memory. Replace the `npm` pretest with pnpm. Unit tests use fakes for both targets and cover equal CIDs, `CidMismatch`, a required Pinata failure, an optional Pinata failure, and a key that never appears in a response or a log. Do not stop the pin service already running on port 8788. Run any live instance on another port.

Done when the tests pass and, once Harsha has put `PINATA_JWT` in the root `.env`, pinning the golden document returns CID `bafkreicjx37puhth4lglmhqqna5gjrcvjedfpputssey6isdy5slgiz7im` with `public: true`, and a clean fetch from Pinata's gateway returns those 234 bytes with the golden hash. If Pinata reports a different CID for the same bytes, stop and report. Without the key, the package is done except for the live check, which is reported as waiting on Harsha.

### After wave 1

**Package 7. Repository hygiene and `pnpm check`.** Owns the root `package.json` scripts other than the dev scripts, `.gitignore`, `contracts/.github`, `contracts/README.md`, and the per-package `package-lock.json` files. Delete Foundry's template README and its nested workflow, delete the npm lockfiles so `pnpm-lock.yaml` is the only lockfile, and add `pnpm check` from section 16. Done when `pnpm install --frozen-lockfile` and `pnpm check` both pass on a fresh clone of the working tree.

### Wave 2, in parallel, after package 5

**Package 8. Verifier library, reader agreement, and the CLI.** Owns `packages/verifier` and `apps/web`. Move the verification logic out of `apps/web/src/lib/reader.ts` into `packages/verifier` and implement sections 10 and 14: reader agreement, the on-chain document, the IPFS copy with the gateway list and the raw CID check, the log filter and range rule, and the green-seal rule. Implement simulate-before-send for every write, and the registration simulation before pinning. Add `pnpm verify-batch`. Done when the automated checks in section 16 pass, the local walkthrough shows Match with one reader, a static build served without a proxy contacts only configured readers and gateways, and the CLI reports the same verdict as the page for the local batch and for a Sepolia lookup.

**Package 9. Indexer for Sepolia and the Compose stack.** Owns `indexer` and `docker-compose.yml`. Implement the header rule and per-range commits in section 13, the image build for the indexer, pinned image tags, the `proofchain_sepolia` database, and the `sepolia` profile. Done when the unit tests in section 13 pass, the live checks pass against version 2 on Anvil, a catch-up against Sepolia from the current deployment block completes with a bounded number of requests that is reported, and `docker compose up --build` brings the whole local stack up from an empty Docker state.

### Wave 3, after package 8

**Package 10. Verification experience.** Owns `apps/web/src` and `apps/web/vercel.json`. The custody timeline, address chips, the tamper simulation, the agreement panel, the friendlier not-found copy, the "Check it yourself" section, and the hosted-build headers in section 14. Done when each element renders for the local batch in its active, pending, and recalled states, on a phone-sized viewport, and the screenshots are in the package report.

### Wave 4, with Harsha

**Package 11. Sepolia rollout and hosting.** Each spend or publish step waits for Harsha's yes at that moment. Deploy version 2 and grant the roles as section 15 describes. Harsha creates B, C, and D in MetaMask, and A funds them. Ask Harsha whether to publish the contract source on Sourcify, which needs no key but makes the source public. Host the site. Register `PCB-2026-R01`, run the full sequence in section 4 from a phone on mobile data, and record it. Done when the rehearsal link verifies with a green seal on a phone with Wi-Fi off, section 19 records every address, block, and transaction, and the recording exists.

**Package 12. Write-up.** Owns `README.md` and `docs/threat-model.md`. Write them from sections 6, 16, and 17, against what was actually deployed and hosted, including the measured Sepolia costs and Slither's result. Done when a stranger can follow the README from a clean machine to the local demo and can verify the live link without the website.

### Stretch

**Package 13. Storage-proof check.** After package 12 only. The verifier asks one reader for `eth_getProof` of the storage slots that hold the batch's custodian and status, checks the proof against the state root of the anchor block whose hash the readers agreed on, and shows the result as a separate line. Done when the proof verifies for the live batch and a tampered proof is rejected in a test.

## 19. Current machine

Re-check before relying on this. Observed on 30 October 2026 during the audit.

- Git: `master` is even with `origin/master` at `4f84209`. `contracts/broadcast/` (version 1 Sepolia deploy receipts) and `handover.md` are untracked and are not committed.
- Tools: Foundry 1.8.6 in `~/.foundry/bin`, Node v24.22.1, pnpm 12.16.1, `uv` in `/usr/bin`. Slither is not installed globally. It runs through `uvx`.
- Tests on 31 October, after packages 5 and 6: `forge test` 39 passed (31 unit, 7 fuzz, and one invariant suite holding all 7 invariants over 2,048 calls). `forge fmt --check` is clean. Node suites 81 passed: indexer 25, metadata 6, pin 27, web 23. The web type-check and production build pass, and the bundle scan finds no key or secret name. Slither last ran against version 1, with 0 results.
- Host processes: Anvil on `127.0.0.1:8545`, restarted on 30 October at about 19:05 UTC in its own session, holding version 2 at `0x5FbDB2315678afecb367f032d93F642f64180aa3`. `PCB-2026-001` is registered with the golden document, active, custodian A. `PCB-2026-R01` ran the whole story: A to B, B to C, a reverted propose from D in block 8 (`NotCurrentCustodian`), and a recall by A with "Damaged seal". Vite on `0.0.0.0:5173`, from `pnpm --dir apps/web dev` in its own session. The pin service on `127.0.0.1:8788` runs the package 6 code, as described under Pinata below. Kubo on `127.0.0.1:5001` and `127.0.0.1:8080`. Not running: Postgres on `5432`, the indexer on `8787`. The Docker daemon is up with no containers running.
- Version 2 gas on Anvil: deploy 1,506,210, each role grant 51,521, registration 237,313 for the golden document, propose 73,906, accept 99,583, recall 35,874. Runtime code is 6,580 bytes. Sepolia's own estimate for the version 2 creation is 10,585,978 gas, and publicnode and 1rpc agreed on it. At a 14 wei base fee and a small priority fee, that is far below the remaining balance.
- Sepolia version 1: `ProductRegistry` at `0x01E560E6F16D86b7764284476a3E57D013bF5840`, block 12028140, creation transaction `0x5bacd211f70e7e8e5c0d6cf3b37a00834b69a4a859cb3957d200f480f23a75b9`, 10,294,291 gas at a 1 gwei priority fee, about 0.0103 Sepolia ETH. Role grants `0x10822de92423aa271d44da174366fb6b667c8746f14c08d84c12feaff195bbab` and `0x5dec34f88d6cd615ed06b26ad0ebf5b1d0d46594beb055b012149f90412a36d3`, 133,541 gas each. Two earlier creation attempts failed out of gas: `0xfca684ba404f5c89756a1c13463122f134342ec0d3aad1c110d7fc4b50a6ae39` at Forge's limit of 2,954,558, and `0x06e829efe21fe2f25592a4d54cea2dbe46aa312bb67bad6de7791cbdfd54cf85` at 6,000,000, which cost 0.006 Sepolia ETH. The files in `contracts/broadcast/` describe the first failed attempt and hold no receipts. No batch is registered on version 1. It will be replaced by version 2 and removed from the trusted list.
- Sepolia account `0xC369d193b2C6594da0dEB59C484D906F3F69CFAB`: admin, manufacturer, and recall on version 1. Nonce 6. Balance 0.033705708355974926 Sepolia ETH. Its key is `PRIVATE_KEY` in the gitignored root `.env`, pasted there by Harsha. Never print it, commit it, or ask for it in chat.
- Sepolia network: the active upgrade reports activation at 2026-10-06 13:53:36 UTC. Block gas limit about 200 million. Base fee between about 16 and 70 wei. Head near block 12,028,525 on 30 October 2026.
- Readers that answered a browser-origin `eth_chainId` with `Access-Control-Allow-Origin: *`: publicnode, 1rpc, Tenderly, thirdweb, and 0xrpc. publicnode rejects `eth_getLogs` ranges over 50,000 blocks. `rpc.sepolia.org`, `rpc2.sepolia.org`, BlastAPI, Omniatech, SubQuery, and dRPC did not work.
- Pinata, 31 October: `PINATA_JWT` is in the root `.env`. The golden document is pinned on Pinata's public network under the golden CID, the only file on the account, confirmed by Pinata's own file list. The dedicated gateway is `https://amethyst-abundant-seahorse-898.mypinata.cloud`, restricted to the account's own files. It and `https://gateway.pinata.cloud` both returned the 234 bytes with the golden hash and `Access-Control-Allow-Origin: *`, in about 1.3 and 5.7 seconds. A 185,620-byte PNG and a 700,000-byte multi-chunk file both got the same CID from Pinata as from Kubo, so the free plan accepted the binary file and the chunk layouts agree. Both test files were then deleted from Pinata and unpinned from Kubo. The pin service on `127.0.0.1:8788` was restarted at about 10:00 UTC with `pnpm pin`, in its own session, with the public copy required. The hosted build's `VITE_IPFS_GATEWAYS` is `https://amethyst-abundant-seahorse-898.mypinata.cloud,https://gateway.pinata.cloud`.
- IPFS on 30 October: the golden CID was pinned only on the laptop's Kubo. `gateway.pinata.cloud` returned 404 "The request timed out searching for a file on the non-pinata IPFS network" after about 33 seconds, three times. The 30 October "pinned on Pinata" result came from Pinata's gateway fetching the file from the laptop at that moment, not from a Pinata pin. `ipfs.io` and `dweb.link` returned 429 to this machine.

## 20. Decision log

| Date | Decision |
| --- | --- |
| 2026-10-29 | Full product scope includes the contract, tests, web app, IPFS, PostgreSQL indexer, public verification, and the trust write-up. |
| 2026-10-29 | A 31 October date was discussed. It is not a reason to thin a package. |
| 2026-10-29 | The user and the agent sessions build the product. Teammates are not an implementation plan. |
| 2026-10-29 | Planning session specifies and verifies. Executor sessions implement one package at a time. |
| 2026-10-29 | Custody language, two-step handoff, admin-granted manufacturer and recall roles, one pending handoff, cancel, recall clears pending, history stored on-chain and in logs. |
| 2026-10-29 | Batch id is `keccak256` of the human batch code. The code is also stored on-chain. |
| 2026-10-29 | QR encodes the verification URL and is regenerated in the browser. It is not an authoritative stored image. |
| 2026-10-29 | Public verification reads Ethereum and IPFS. The indexer serves dashboard search. |
| 2026-10-29 | One QR per batch or package, not per component. Metadata is append-only by deploying a new registration rather than editing the old one. |
| 2026-10-29 | Demo chain is Sepolia. Local chain is Anvil. Account A may hold both demo roles. Tests keep the roles separate. |
| 2026-10-29 | Three pre-implementation reviews: same-origin proxies for the LAN demo, a read-only `/rpc` with whole-batch rejection and no WebSocket, pin POST limited to a loopback peer and a localhost Host, green seals limited to `trusted-deployments.json`, recall reason at most 128 bytes with `_checkRole` after existence and status, indexer refuses a chain or contract change and detects an Anvil reset from `start_block_hash`. |
| 2026-10-30 | Packages 1 through 4 and the integration files accepted. `ZeroAddress` is only a zero admin. A zero recipient and a self-handoff are `InvalidRecipient`. Propose and cancel check the custodian before the pending handoff. Accept checks that a handoff is pending before it checks the recipient. `CONFIRMATIONS` defaults to 0, and to 2 on Sepolia. Pushed to the private repository. |
| 2026-10-30 | Version 1 deployed to Sepolia at `0x01E560E6F16D86b7764284476a3E57D013bF5840`. GitHub Actions removed on Harsha's instruction after a run hung. The README stays a public project page. |
| 2026-10-30 | Audit by the new orchestrator. Every suite and Slither re-run and passing. The indexer, never run against Postgres before, was run against a throwaway Postgres: it projected the local demo, rewound a real `anvil_reorg`, resynced after an Anvil restart, and survived an RPC outage. The production build reads only the public reader. |
| 2026-10-30 | The 10.3 million gas Sepolia creation is explained by Sepolia's 6 October 2026 repricing of state creation, measured with read-only estimates. It is not a contract defect. Sepolia gas limits come from Sepolia's estimate. |
| 2026-10-30 | The earlier "document pinned on Pinata" check was a false positive. The golden document is only on the laptop's Kubo. |
| 2026-10-30 | The hosted site on Sepolia is the primary demo. The local stack is the development environment and the fallback. |
| 2026-10-30 | Contract version 2: the registration carries the document, the contract computes `metadataHash`, `BatchRegistered` publishes the document, and the document limit is 4096 bytes. The custody protocol is unchanged. It is deployed before the first Sepolia registration, while no label names version 1, and version 1 leaves the trusted list. |
| 2026-10-30 | `current` means the newest deployment on its own chain. `VITE_WRITE_CHAIN_ID` selects the write chain. Two Vite modes, local and sepolia. `VITE_CONTRACT_ADDRESS` is removed. Each deployment lists several readers. |
| 2026-10-30 | The pin service adds Pinata for the public copy, with identical CIDs required and the key kept server-side. Harsha supplies `PINATA_JWT` in the root `.env`. |
| 2026-10-30 | The verification page requires agreement between independent readers at one anchor block for a green seal. The verification logic moves to `packages/verifier`, shared with a CLI. |
| 2026-10-30 | Every write is simulated before the wallet opens. A rejection can still be sent on purpose. |
| 2026-10-30 | The indexer stores headers for log blocks and a trailing window, commits per range, and runs against Sepolia on the laptop in its own database. |
| 2026-10-30 | The test gate is a local `pnpm check` before every push. No GitHub Actions, by Harsha's choice. |
| 2026-10-30 | The orchestrator runs executors as subagents and verifies their work itself. Spending, deploying, publishing, and pushing wait for Harsha each time. |
| 2026-10-31 | Package 5 accepted after the orchestrator re-ran every check, read the diff, and verified both local batches in the browser. The executor stopped before reporting, so the gas numbers and the Sepolia estimate in section 19 were measured by the orchestrator. |
| 2026-10-31 | Package 6 accepted. The public copy is a plain Pinata v3 upload with `cid_version=v1`, which Pinata documents as Kubo's `cid-version=1` layout. A CID mismatch fails closed whatever `PIN_REQUIRE_PUBLIC` says. CAR upload needs a paid plan and pin-by-CID needs the laptop reachable, so neither was used. A body over 5 MB now gets the 413 response instead of a reset connection. The live Pinata check waits on `PINATA_JWT`. |
| 2026-10-31 | Package 7 done by the orchestrator. The npm lockfiles and Foundry's template README and workflow are deleted. `pnpm check` runs `scripts/check.mjs`, which finds Foundry in `~/.foundry/bin` by itself, builds the hosted bundle in mode sepolia, and scans it for the forbidden names, the four Anvil keys, and the values of `PRIVATE_KEY` and `PINATA_JWT` from `.env` without printing them. A planted string made it fail at the scan. |
| 2026-10-31 | Package 6 live check passed with Harsha's key: Pinata returned Kubo's CID for the golden document, a PNG, and a multi-chunk file. The pin service now reads only its own six variables from the root `.env`. |
| 2026-10-31 | Package 8 accepted. `packages/verifier` is the one implementation of agreement, the document checks, and the seal, and `pnpm verify-batch` is its second client. The CLI and the page agree on both local batches and on the five Sepolia readers agreeing that the v1 contract has no batch. A static build contacted only its own origin and those readers. An empty gateway list means same-origin `/ipfs` only while `pnpm dev` is running. The hosted mode lists the Pinata gateways. |
| 2026-10-31 | Package 9 accepted after the executor stopped before its report. The orchestrator re-read the sync and Compose files and re-ran the 33 indexer tests. The executor's own live log records the reorg rewind, the Anvil restart, the RPC outage, a 133,182-block Sepolia catch-up in 70 requests, and a Compose run from an empty state. Its `sudo -n true` was a no-password probe, changed nothing, and is not to be repeated. Images are pinned: `postgres:16.15-alpine`, `node:24.22.1-bookworm-slim`, `ipfs/kubo:v0.43.1`, `ghcr.io/foundry-rs/foundry:v1.8.6`. |

## 21. Considered and not taken

- **Keep version 1 and rely on Pinata alone.** Public verification of the commitment-bearing document would then depend on one pinning company staying up and on the pin having been made. Version 2 costs one redeploy before any label exists. Not taken.
- **Store the document in contract storage.** At about 111,000 gas per new slot on Sepolia, a 234-byte document would cost about eight slots per registration for no verification gain over the event. Not taken.
- **Pack the `Batch` struct.** Reordering fields would save one slot, about 111,000 gas per Sepolia registration, but would change the `getBatch` ABI, the `cast` command, and every reader. Not taken.
- **Signed acceptance with EIP-712, so a recipient needs no ETH.** Relevant in practice, because a retailer should not need a wallet balance, but it needs a relayer and widens the protocol. Future work for the write-up.
- **A light client in the browser.** Verifying headers from the consensus layer in the page is the strongest check, but it is heavy and depends on client support for Sepolia's newest upgrade. Reader agreement now, storage proofs as the stretch package.
- **A layer-2 testnet for two-second blocks.** Faster for a live demo, but it adds a sequencer as a trust point and weakens the claim that Ethereum consensus maintains the record. Not taken. Narrate the 12-second blocks.
- **Hosting the indexer.** A server and a database for a convenience the public page does not use. Not taken.
- **An NFT per batch.** ERC-721 transfer does not need the recipient's acceptance, and custody is not ownership. Not taken.
- **An upgradeable proxy.** A proxy would let an admin change the rules behind printed labels. Not taken.
- **GitHub Actions.** Removed by Harsha after a run hung. Replaced by `pnpm check`.
- **Per-unit serialization or secure tags.** Out of scope for one QR per batch.

## 22. Implementation choices accepted in phase 1

These were open in the plan. The implementations made them, the tests pass, and later packages use them as written.

- The nested `contracts/.git` directory was removed before the first commit. `contracts/lib` stays in the repository as vendored source. Do not delete it and do not turn it back into a nested repository.
- Package names are `@proofchain/metadata`, `@proofchain/pin`, `@proofchain/indexer`, and `@proofchain/web`.
- Pin errors are JSON `{ "error", "message" }`. `POST /metadata` accepts only `canonical` and `batchCode`. An empty blob is 400, a body over 5 MB is 413, and a Kubo failure is 502. Pin listens on `127.0.0.1:8788`.
- Kubo is called with `cid-version=1` and `pin=true`.
- Hono is only the pin router and the indexer router. Unused Hono dependency paths reported by `npm audit` are not a reason to mount extra middleware.
- The indexer listens on `127.0.0.1` unless `INDEXER_HOST` is set.

## 23. Glossary

| Term | Meaning |
| --- | --- |
| Batch code | Human id such as `PCB-2026-001`. It appears in the URL and in the document. |
| Batch id | `keccak256` of the batch code's UTF-8 bytes. Primary key inside the contract and the indexer. |
| Custodian | The wallet that may currently propose or cancel a handoff. |
| Commitment | `metadataHash`, the `keccak256` of the canonical document bytes, computed by the contract. |
| On-chain document | The document bytes published in the batch's `BatchRegistered` event. |
| IPFS copy | The same bytes pinned to IPFS under `metadataCid`. |
| CID | IPFS content identifier for those bytes, or for the optional file. |
| Reader | One Ethereum JSON-RPC endpoint the verifier asks. |
| Anchor block | The block number at which every reader is asked for the record. |
| Agreement | At least two readers, or the only configured reader, returning identical answers at the anchor block, with none disagreeing. |
| Write chain | The chain the app writes to and that new QR codes name, set by `VITE_WRITE_CHAIN_ID`. |
| Operator console | The laptop's `pnpm dev:sepolia` session, which can pin and register. |
| Simulation | An `eth_call` of a write, as the connected wallet, before the wallet opens. |
| Receipt | The confirmed result of a transaction. Success is `status == 1`. |
| Projection | Indexer tables rebuilt from logs. Disposable. |
| Safe head | Latest block minus `CONFIRMATIONS`. The indexer does not project past it. |
| Match | The document satisfies every check in section 10. |
| Mismatch | A document source was read, and at least one check failed. |
| Unavailable | Neither document source could be read. Chain state is still shown. |
