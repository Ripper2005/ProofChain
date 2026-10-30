# ProofChain

ProofChain is a shared custody log for a product batch: Ethereum records who registered it, who accepted each handoff, and whether it was recalled, and anyone can check that record without trusting one company's database.

The chain records claims. It shows what was submitted and which wallet signed it. It does not prove the physical goods are genuine. A QR code is a pointer, not a seal on the object. Someone can copy the label onto a different box, and that copied QR still opens the same record. ProofChain checks the recorded story and which wallet signed it.

A batch is one package, such as a box of 50 boards, and it has one QR. Custody is the registered wallet that currently holds the batch. A handoff is a proposed transfer that the named recipient must accept. After a transaction is confirmed, that history is tamper-evident: a participant cannot quietly rewrite it in a private database and have the chain accept the edit as the shared record. The commitment is the `keccak256` of the canonical product document. The contract stores that commitment, the IPFS content identifier, the current custodian, and whether the batch is active or recalled.

The protocol is [MASTER_PLAN.md](MASTER_PLAN.md). The trust write-up is [docs/threat-model.md](docs/threat-model.md).

## How to run the local stack

You need Node.js 24 or newer, pnpm 12.16.1, Foundry, and Docker. The phone path also needs a wallet extension on the laptop, such as MetaMask, and a phone on the same network.

From the repository root:

```sh
pnpm install
cp .env.example .env
cp .env.example apps/web/.env
```

Vite reads `apps/web/.env`. Compose and the deploy script read the root `.env`. Leave `PRIVATE_KEY` empty in `apps/web/.env`. The web app does not read it.

For a local solo demo, set `PRIVATE_KEY` in the root `.env` to Anvil account 0 below. `.env.example` already sets the admin, manufacturer, and recall addresses to that account. These are Anvil's public development keys. Anvil prints them at startup. Never use them on Sepolia or mainnet.

| Account | Demo role | Address | Development key |
| --- | --- | --- | --- |
| A | Manufacturer and recall | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| B | Accepts custody from A, then proposes to C | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| C | Accepts custody from B | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| D | Attempts a handoff, and the contract reverts | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` |

Start the stack. Published ports stay on `127.0.0.1`. The web app is the process the phone must reach, and it runs on the host.

```sh
docker compose up --build
```

If starting the Docker daemon asks for a password, stop and ask the person at the machine. Do not guess the password.

In another terminal, deploy `ProductRegistry` to Anvil. The script reads `PRIVATE_KEY`, `ADMIN_ADDRESS`, `MANUFACTURER_ADDRESS`, and `RECALLER_ADDRESS` from the environment. It reverts unless the key belongs to `ADMIN_ADDRESS`. It prints the contract address and does not print the key.

```sh
set -a
. ./.env
set +a
cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast
```

Write the printed address into `CONTRACT_ADDRESS` and `VITE_CONTRACT_ADDRESS` in the root `.env`, into `VITE_CONTRACT_ADDRESS` in `apps/web/.env`, and into `apps/web/trusted-deployments.json`. For local Anvil the entry is chain id `31337`, `current: true`, and `rpcUrl` left empty so the page uses same-origin `/rpc`. Set `startBlock` to the deployment block, or to `0`. Then recreate the indexer so it leaves the waiting loop, and start the site:

```sh
docker compose up -d --force-recreate indexer
pnpm --dir apps/web dev
```

Restart the dev server after you change `apps/web/.env` or `trusted-deployments.json`. Open the manufacturer browser at `http://localhost:5173`. A LAN address over HTTP is not a secure context, so the wallet stays on localhost. In the wallet, add a network named Anvil with RPC `http://127.0.0.1:8545`, chain id `31337`, and currency ETH. Wallet writes go to that URL directly. They do not go through the site proxy. Import accounts A, B, C, and D with the development keys above.

The dev server listens on `0.0.0.0:5173`. On the registration screen, the QR origin field is prefilled from `VITE_PUBLIC_ORIGIN` or from the page origin. For a phone, type `http://<this-computer-lan-ip>:5173` there. The field regenerates the QR without a restart. A QR whose origin is `localhost` or `127.0.0.1` will not work on a phone: JavaScript on the phone would call the phone, not this computer. Classroom Wi-Fi often isolates clients. A phone hotspot is the backup. The read-only `/rpc` rule stays on either way.

Regenerate the checked-in ABI after a contract change:

```sh
cd contracts && forge build
pnpm --dir apps/web generate:abi
```

### A demo that survives the laptop leaving

The LAN demo that has been exercised is on the laptop: registration, two handoffs, the rejected transfer, and recall. The public page on that laptop shows Recalled and Match for `PCB-2026-001`. A second phone on a guest-isolated hotspot did not load the page. That check still needs a network that lets the phone reach the laptop.

A demo that still works after the laptop leaves the room needs three things that are not in place:

- a hosted copy of the static build
- a keyless public RPC on the deployment entry in `trusted-deployments.json`
- document bytes pinned where a public gateway can fetch them

Bytes pinned only to the local Kubo node are not automatically on public gateways. `rpcUrl` in the checked-in deployment list is empty. Sepolia, chain id `11155111`, is not deployed. There is no Sepolia contract address, no funded testnet key in this repository, and no mainnet deployment. Do not invent a private key or faucet ETH. The same deploy script can target Sepolia later, with a user-supplied RPC URL and a user-supplied test key, and with test ETH only.

## Demo sequence

Use four browser accounts. Account A holds both the manufacturer role and the recall role for the solo demo. The contract tests keep those roles on different addresses.

The registration form is prefilled with the demo batch: STM32 Controller Development Board, SKU `CTRL-STM32-A`, batch code `PCB-2026-001`, quantity 50, production date 2026-10-15, company name Demo Electronics Pvt. Ltd. That company name is a claim inside the product document. The manufacturer the contract recognizes is the wallet that signs `registerBatch`. Batch codes are case-sensitive.

1. Account A registers `PCB-2026-001`. The QR appears only after a successful receipt. If the wallet rejects the prompt, or the receipt fails, any pin that already happened stays on IPFS and the page does not offer a QR. Download the QR after the receipt.
2. Scan it on a phone. The page shows the document, the registration transaction, custodian A, and status active. The phone does not connect a wallet.
3. A proposes custody to B. B accepts. Refresh the phone. The history shows that handoff.
4. B proposes custody to C. C accepts. The phone shows both handoffs and C as the current custodian.
5. D tries to propose a transfer from the custody page. The interface shows the contract revert. A disabled button is not a substitute for that revert.
6. A recalls the batch and can enter a short reason. The same QR now shows recalled.

Say this limitation out loud: copying the sticker onto another box is possible. ProofChain checks the recorded story and who signed it.

## Tests

Contract tests:

```sh
cd contracts && forge test
```

Node unit tests for metadata, pin, the indexer, and the web app. They do not need Docker:

```sh
pnpm test
```

GitHub Actions runs `forge test` and those four Node suites. It does not start Docker. Slither's result is recorded in [docs/threat-model.md](docs/threat-model.md).
