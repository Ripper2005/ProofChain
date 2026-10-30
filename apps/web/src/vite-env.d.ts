/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTRACT_ADDRESS?: string;
  readonly VITE_PUBLIC_ORIGIN?: string;
  readonly VITE_INDEXER_URL?: string;
  readonly VITE_IPFS_GATEWAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
