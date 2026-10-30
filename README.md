# ProofChain

[![tests](https://github.com/Ripper2005/ProofChain/actions/workflows/test.yml/badge.svg)](https://github.com/Ripper2005/ProofChain/actions/workflows/test.yml)

A batch of boards can pass through a manufacturer, a distributor, and a retailer, with each company keeping its own spreadsheet. When those records disagree, there is no common history to inspect.

ProofChain is a shared custody log for a product batch. Ethereum records who registered it, who accepted each handoff, and whether it was recalled. Anyone with the link can check that record without trusting one company's database.

The chain records claims and the wallet that signed them. It does not prove the physical goods are genuine. A QR code is a pointer, not a seal on the box. Copy the label onto another box and the same record still opens.

One batch, such as a box of 50 boards, has one QR. Custody is the wallet that currently holds that batch. A handoff counts only when the current custodian proposes it and the named wallet accepts it. The commitment is the `keccak256` of the canonical product document. The contract stores that commitment, the IPFS content identifier, the current custodian, and whether the batch is active or recalled. Confirmed history is tamper-evident: a participant cannot quietly rewrite it in a private database and have the chain accept the edit as the shared record.

The protocol is [MASTER_PLAN.md](MASTER_PLAN.md). The trust write-up is [docs/threat-model.md](docs/threat-model.md).

## Status

| | |
| --- | --- |
| Local demo | Exercised on Anvil: registration, two handoffs, a rejected transfer, and a recall. The verification page shows **Recalled** and **Match** for batch `PCB-2026-001`. |
| Phone | Not completed. A second phone on a guest-isolated hotspot could not reach the laptop. |
| Public demo | Not deployed. Sepolia, a hosted site, a keyless public RPC, and a public IPFS gateway are still required before the page works after this laptop is gone. |

Bytes pinned only to the local IPFS node are not automatically on public gateways. This repository contains no mainnet deployment and no private key.

## How a batch moves

1. A manufacturer with `MANUFACTURER_ROLE` registers the batch code, the document hash, and the IPFS content identifier.
2. The current custodian proposes one handoff to a named wallet.
3. That wallet accepts, and custody moves. The recipient needs no global role.
4. A wallet with `RECALL_ROLE` can recall the batch. Recall is irreversible and clears any pending handoff.

An unauthorized proposal reverts in the contract. Distributors and retailers are ordinary accounts. The company name inside the product document is a claim. The manufacturer the contract recognizes is the wallet that signed the registration.

## Layout

| Path | Role |
| --- | --- |
| `contracts/` | `ProductRegistry`. Solidity 0.8.28, Foundry, OpenZeppelin AccessControl. |
| `packages/metadata/` | Canonical document, batch id, and metadata hash. |
| `services/pin/` | Pins those bytes to a local Kubo node. |
| `apps/web/` | Register, handoff, recall, and the public verification page. |
| `indexer/` | Derived PostgreSQL search index. The public page does not depend on it. |
| `docker-compose.yml` | Local Anvil, Postgres, Kubo, pin, and indexer, published on `127.0.0.1` only. |

The verification page reads Ethereum and IPFS. Wallet writes go to the node directly. They do not go through the site's read-only `/rpc` proxy.

## Local demo

You need Node.js 24 or newer, pnpm 12.16.1, Foundry, and Docker, plus a browser wallet such as MetaMask.

```sh
pnpm install
cp .env.example .env
cp .env.example apps/web/.env
```

The root `.env` is for Compose and the deploy script. `apps/web/.env` is for Vite. Leave `PRIVATE_KEY` empty in the web file. The app never reads it.

For the solo local demo, set `PRIVATE_KEY` in the root `.env` to Anvil account 0 from the table below. `.env.example` already points the admin, manufacturer, and recall addresses at that account. These are Anvil's public development keys. Never use them on Sepolia or mainnet.

```sh
docker compose up --build
```

In a second terminal, deploy the contract. The script reverts unless the key belongs to `ADMIN_ADDRESS`, and it prints the contract address without printing the key.

```sh
set -a
. ./.env
set +a
cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast
```

On a fresh Anvil chain, the first contract created by account 0 is `0x5FbDB2315678afecb367f032d93F642f64180aa3`. Write the printed address into `CONTRACT_ADDRESS` and `VITE_CONTRACT_ADDRESS` in the root `.env`, into `VITE_CONTRACT_ADDRESS` in `apps/web/.env`, and into `apps/web/trusted-deployments.json`. For local Anvil the entry is chain id `31337`, `current: true`, and `rpcUrl` left empty so the page uses same-origin `/rpc`. Set `startBlock` to the deployment block, or to `0`.

```sh
docker compose up -d --force-recreate indexer
pnpm --dir apps/web dev
```

Open `http://localhost:5173`. In the wallet, add a network named Anvil with RPC `http://127.0.0.1:8545`, chain id `31337`, and currency ETH. Import the four development accounts. Restart the dev server after changing `apps/web/.env` or `trusted-deployments.json`.

The dev server listens on `0.0.0.0:5173`. The QR origin is an editable field, prefilled from `VITE_PUBLIC_ORIGIN` or the page origin. A phone needs that field set to `http://<this-computer-lan-ip>:5173`. An origin of `localhost` or `127.0.0.1` points the phone at itself. The phone and the laptop also have to be on a network that allows the two devices to reach each other. Guest isolation on a shared hotspot blocks the page even when both devices show the same Wi-Fi name.

After a contract change, regenerate the checked-in ABI:

```sh
cd contracts && forge build
pnpm --dir apps/web generate:abi
```

### Development accounts

| Account | Role in the demo | Address | Key |
| --- | --- | --- | --- |
| A | Manufacturer and recall | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| B | Accepts from A, then proposes to C | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| C | Accepts from B | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| D | Proposes without custody, and the contract reverts | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` |

The contract tests keep the manufacturer and recall roles on separate addresses. The solo demo may place both roles on account A.

### Walkthrough

The registration form is prefilled with STM32 Controller Development Board, SKU `CTRL-STM32-A`, batch code `PCB-2026-001`, quantity 50, production date 2026-10-15, and the company name Demo Electronics Pvt. Ltd. That company name is a claim in the document. Batch codes are case-sensitive.

1. Account A registers `PCB-2026-001`. The QR appears only after a successful receipt. A rejected wallet prompt or a reverted receipt leaves any pin that already happened on IPFS and does not offer a QR.
2. Open the verification link. The page shows the document, the registration transaction, custodian A, and status active. It does not ask for a wallet.
3. A proposes custody to B. B accepts. The history shows that handoff.
4. B proposes custody to C. C accepts. The history shows both handoffs, and C is the current custodian.
5. D tries to propose a transfer. The interface shows the contract revert.
6. A recalls the batch, with an optional short reason. The same link now shows recalled.

The local chain has already been taken through this sequence. The recall reason on that run is "Damaged seal".

## Tests

```sh
cd contracts && forge test
pnpm test
```

`pnpm test` runs the metadata, pin, indexer, and web suites. Those do not need Docker. GitHub Actions runs the same checks. Slither 0.11.6 reported no findings. The accepted limits of this version, including the single admin key, are written up in [docs/threat-model.md](docs/threat-model.md).
