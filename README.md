# ProofChain

ProofChain is a shared custody log for a product batch: Ethereum records who registered it, who accepted each handoff, and whether it was recalled, and anyone can check that record without trusting one company's database.

When a shipment moves from a manufacturer to a distributor and then to a retailer, each company keeps its own spreadsheet. ProofChain puts the batch, the document commitment, the current custodian, and any recall on Ethereum, so those parties can check one record instead of reconciling three.

A batch is one package, such as a box of fifty boards, and it has one QR code. The code opens a verification page. That page reads the contract and the product document. It does not ask for a wallet.

## What the record can show

The contract stores the batch code, the `keccak256` of the canonical product document, the IPFS content identifier, the current custodian, and whether the batch is active or recalled.

Custody moves only when the current holder proposes a handoff and the named wallet accepts it. A manufacturer registers the batch. A separate recall role can freeze it. Recall is irreversible. Distributors and retailers do not need a global role. They act with the wallet that holds custody, or the wallet named in a proposal.

The company name in the product document is a claim made by whoever wrote that document. The manufacturer the contract recognizes is the wallet that signed the registration.

## What it cannot show

The chain records a claim and the wallet that signed it. It does not prove that the physical goods are genuine. A copied QR code still opens the same record, because the code is a pointer to the batch, not a seal on the box. ProofChain verifies the record and its document; it does not authenticate the manufacturer or inspect the goods.

Confirmed history is tamper-evident under ordinary Ethereum assumptions. A participant cannot edit that history inside a private database and have the contract treat the edit as the shared record.

## Repository

| Path | What it is |
| --- | --- |
| `contracts/` | `ProductRegistry`. Solidity 0.8.28, Foundry, OpenZeppelin AccessControl. |
| `packages/metadata/` | Canonical product document, batch id, and metadata hash. |
| `services/pin/` | Pins document bytes to local Kubo and, when configured, a public Pinata copy. |
| `apps/web/` | Registration, handoff, recall, and public verification. |
| `indexer/` | Search index in PostgreSQL, built from contract logs. Verification does not use it. |
| `docker-compose.yml` | Local Anvil, Postgres, Kubo, the pin service, and the indexer. |

Wallet transactions go to the node the wallet is using. In local development, the site's `/rpc` path is a read-only proxy for verification reads; wallet writes never go through it.

## Run it locally

Node.js 24 or newer, pnpm 12.16.1, Foundry, and Docker. A browser wallet is required for registration, handoff, and recall.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
cp .env.example apps/web/.env
```

Compose and the deploy script read the root `.env`. Vite reads `apps/web/.env`. For a local demo, set `PRIVATE_KEY` in the root file to Anvil account A's public development key in the table below. The example file already sets the admin, manufacturer, and recall addresses to account A. Never use an Anvil key on Sepolia or mainnet; never put a real key in `apps/web/.env`.

```sh
docker compose up --build -d
```

Deploy the contract and grant the manufacturer and recall roles to A:

```sh
set -a && . ./.env && set +a
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast --root contracts
```

The script refuses to run unless the signing key belongs to `ADMIN_ADDRESS`. It prints the contract address. On a fresh Anvil chain, account A's first contract is `0x5FbDB2315678afecb367f032d93F642f64180aa3`, already listed as the local deployment in `apps/web/trusted-deployments.json`. Set `CONTRACT_ADDRESS` in the root `.env` to the printed address if it differs from that default.

```sh
pnpm --dir apps/web dev
```

Open [http://localhost:5173](http://localhost:5173). In MetaMask, add Anvil as a network (RPC `http://127.0.0.1:8545`, chain id `31337`, currency ETH) and import the four public Anvil accounts below.

The dev server listens on every interface, port `5173`. The local verification page reads through its development proxy. Restart the dev server after changing `apps/web/.env` or `trusted-deployments.json`.

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

Batch codes are case-sensitive. The company name is part of the document, not an identity check. `PCB-2026-001` is the golden local batch and should remain active with account A. To rehearse the complete sequence below, use a fresh batch code such as `PCB-2026-R01` in both the form and document.

1. Account A registers the rehearsal batch. The QR code appears after the transaction receipt succeeds.
2. Open the verification link. The page shows the document, the registering wallet, and status active.
3. A proposes custody to B. B accepts.
4. B proposes custody to C. C accepts. The page lists both handoffs, and C is the custodian.
5. D tries to propose a handoff. The page simulates the call first and shows `NotCurrentCustodian` before opening the wallet. "Send anyway" may be used to demonstrate a mined revert if the wallet permits it; wallets can block transactions they predict will fail.
6. A recalls the batch. A short reason is optional. The same link now shows the batch as recalled.

## Tests

```sh
forge test --root contracts
pnpm test
pnpm check
```

`pnpm test` runs the metadata, verifier, pin, indexer, and web tests. `pnpm check` is the full gate: formatting, build, contract and Node tests, web type-check, hosted build, and bundle secret scan. Docker is not required for tests.

The security notes are in [docs/threat-model.md](docs/threat-model.md).

## Sepolia

`ProductRegistry` v2 is deployed on Sepolia (chain id `11155111`) at [`0x085156D33591d8DCce11703017D9B078bdEb837b`](https://sepolia.etherscan.io/address/0x085156D33591d8DCce11703017D9B078bdEb837b). The deploying account holds the admin, manufacturer, and recall roles. The hosted verifier is [proofchain-snowy.vercel.app](https://proofchain-snowy.vercel.app). It uses four configured public readers and public IPFS gateways; the verifier does not require a connected wallet.

Two rehearsal batches are registered: `PCB-2026-R01` is recalled after the A → B → C custody sequence, and `PCB-2026-R02` is active with A as custodian. R02 is the current active example:

[Verify PCB-2026-R02](https://proofchain-snowy.vercel.app/verify/11155111/0x085156D33591d8DCce11703017D9B078bdEb837b/PCB-2026-R02)

The hosted verifier and CLI include an optional EIP-1186 storage-proof check. It verifies the contract account and the batch's custodian and status slots against the state root at the readers' agreed anchor block. The proof result is separate from the green seal: it does not change the seal. This checks data against a reader-reported state root; it is not a light client and does not independently verify Ethereum consensus. If no readers agree, or the selected RPC does not support `eth_getProof`, the check is reported as unavailable.

You can independently check the live link without using the website's JavaScript. From a clean checkout, run:

```sh
pnpm install --frozen-lockfile
pnpm verify-batch 'https://proofchain-snowy.vercel.app/verify/11155111/0x085156D33591d8DCce11703017D9B078bdEb837b/PCB-2026-R02' \
  --gateway https://amethyst-abundant-seahorse-898.mypinata.cloud \
  --gateway https://gateway.pinata.cloud
```

Or read the on-chain batch directly with Foundry's `cast`:

```sh
cast call 0x085156D33591d8DCce11703017D9B078bdEb837b \
  'getBatch(bytes32)((string,address,address,bytes32,string,uint8,uint64))' \
  0xe9f429beedc9e905a5caa11f8dbacc983983c3b63458d361b0fc7d8d8fdb7d6f \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

### Measured Sepolia costs

All figures are test ETH. ETH cost depends on the effective gas price at the time; these are the observed v2 deployment and R01 rehearsal values:

| Action | Gas used | Approximate cost |
| --- | ---: | ---: |
| Deploy v2 | 10,501,466 | 0.00105015 ETH |
| Grant manufacturer role | 133,541 | 0.00001335 ETH |
| Grant recall role | 133,541 | 0.00001335 ETH |
| Register a rehearsal document | 935,219 | 0.00009352 ETH |
| Propose A → B | 243,946 | 0.00002439 ETH |
| Accept as B | 365,611 | 0.00054842 ETH |
| Propose B → C | 243,946 | 0.00036592 ETH |
| Accept as C | 267,691 | 0.00040154 ETH |
| Recall | 37,074 | 0.00000371 ETH |

Sepolia's post-October-2026 state-creation pricing makes the deployment and first writes much more expensive in gas than Anvil estimates. Use Sepolia's own `eth_estimateGas` and leave a margin; local estimates are not a safe transaction gas limit. The source has not been published on Sourcify.
