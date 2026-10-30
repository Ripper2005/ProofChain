# ProofChain

[![tests](https://github.com/Ripper2005/ProofChain/actions/workflows/test.yml/badge.svg)](https://github.com/Ripper2005/ProofChain/actions/workflows/test.yml)

A shared custody log for a product batch.

When a shipment moves from a manufacturer to a distributor and then to a retailer, each company keeps its own spreadsheet. ProofChain puts the batch, the document commitment, the current custodian, and any recall on Ethereum, so those parties can check one record instead of reconciling three.

A batch is one package, such as a box of fifty boards, and it has one QR code. The code opens a verification page. That page reads the contract and the product document. It does not ask for a wallet.

## What the record can show

The contract stores the batch code, the `keccak256` of the canonical product document, the IPFS content identifier, the current custodian, and whether the batch is active or recalled.

Custody moves only when the current holder proposes a handoff and the named wallet accepts it. A manufacturer registers the batch. A separate recall role can freeze it. Recall is irreversible. Distributors and retailers do not need a global role. They act with the wallet that holds custody, or the wallet named in a proposal.

The company name in the product document is a claim made by whoever wrote that document. The manufacturer the contract recognizes is the wallet that signed the registration.

## What it cannot show

The chain records a claim and the wallet that signed it. It does not prove that the physical goods are genuine. A copied QR code still opens the same record, because the code is a pointer to the batch, not a seal on the box.

Confirmed history is tamper-evident under ordinary Ethereum assumptions. A participant cannot edit that history inside a private database and have the contract treat the edit as the shared record.

## Repository

| Path | What it is |
| --- | --- |
| `contracts/` | `ProductRegistry`. Solidity 0.8.28, Foundry, OpenZeppelin AccessControl. |
| `packages/metadata/` | Canonical product document, batch id, and metadata hash. |
| `services/pin/` | Pins document bytes to IPFS through Kubo. |
| `apps/web/` | Registration, handoff, recall, and public verification. |
| `indexer/` | Search index in PostgreSQL, built from contract logs. Verification does not use it. |
| `docker-compose.yml` | Local Anvil, Postgres, Kubo, the pin service, and the indexer. |

Wallet transactions go to the node the wallet is using. The site's `/rpc` path is a read-only proxy for the verification page.

## Run it locally

Node.js 24 or newer, pnpm 12.16.1, Foundry, and Docker. A browser wallet is required for registration, handoff, and recall.

```sh
pnpm install
cp .env.example .env
cp .env.example apps/web/.env
```

Compose and the deploy script read the root `.env`. Vite reads `apps/web/.env`. For a local demo, set `PRIVATE_KEY` in the root file to Anvil account 0 below. The example file already sets the admin, manufacturer, and recall addresses to that account. Leave `PRIVATE_KEY` empty in `apps/web/.env`.

```sh
docker compose up --build
```

Deploy the contract:

```sh
set -a && . ./.env && set +a
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast --root contracts
```

The script refuses to run unless the signing key belongs to `ADMIN_ADDRESS`. It prints the contract address. On a fresh Anvil chain, the first contract created by account 0 is `0x5FbDB2315678afecb367f032d93F642f64180aa3`.

Put that address in `CONTRACT_ADDRESS` and `VITE_CONTRACT_ADDRESS` in the root `.env`, in `VITE_CONTRACT_ADDRESS` in `apps/web/.env`, and in `apps/web/trusted-deployments.json`. The local entry uses chain id `31337`, `current: true`, and an empty `rpcUrl`, so the page reads through the dev server. Set `startBlock` to the deployment block, or to `0`.

```sh
docker compose up -d --force-recreate indexer
pnpm --dir apps/web dev
```

Open [http://localhost:5173](http://localhost:5173). Add an Anvil network in the wallet: RPC `http://127.0.0.1:8545`, chain id `31337`, currency ETH. Import the four accounts below.

The dev server listens on every interface, port `5173`. To open a verification link from another device, set the QR origin on the registration screen to `http://<this-computer-lan-ip>:5173`. `localhost` points that device at itself. Restart the dev server after changing `apps/web/.env` or `trusted-deployments.json`.

After changing the contract, refresh the checked-in ABI:

```sh
forge build --root contracts
pnpm --dir apps/web generate:abi
```

### Anvil accounts

These are Anvil's public development keys. They are safe for the local chain. Do not use them on Sepolia or mainnet.

| Account | Demo use | Address | Key |
| --- | --- | --- | --- |
| A | Manufacturer and recall | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| B | Accepts from A, then proposes to C | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| C | Accepts from B | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| D | Proposes without custody | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` |

The tests keep manufacturer and recall on different addresses. A solo demo can grant both roles to account A.

### Sample batch

The registration form is filled with this batch:

| Field | Value |
| --- | --- |
| Name | STM32 Controller Development Board |
| SKU | `CTRL-STM32-A` |
| Batch code | `PCB-2026-001` |
| Quantity | 50 |
| Production date | 2026-10-15 |
| Company name | Demo Electronics Pvt. Ltd. |

Batch codes are case-sensitive. The company name is part of the document, not an identity check.

1. Account A registers the batch. The QR code appears after the transaction receipt succeeds.
2. Open the verification link. The page shows the document, the registering wallet, and status active.
3. A proposes custody to B. B accepts.
4. B proposes custody to C. C accepts. The page lists both handoffs, and C is the custodian.
5. D submits a proposal. The contract reverts, and the page shows that revert.
6. A recalls the batch. A short reason is optional. The same link now shows the batch as recalled.

## Tests

```sh
forge test --root contracts
pnpm test
```

`pnpm test` runs the metadata, pin, indexer, and web tests. Docker is not required. The same checks run in GitHub Actions.

The security notes are in [docs/threat-model.md](docs/threat-model.md).

## Network deployment

This repository runs the stack against local Anvil. Publishing the verification page for anyone on the internet also requires a deployed contract, a public RPC endpoint with no API key in the client, a hosted build of `apps/web`, and product documents that a public IPFS gateway can fetch. Documents pinned only to the local Kubo node are not on public gateways by default.
