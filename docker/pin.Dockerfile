# Build context: the repository root. Dependencies and the metadata build happen here, never when the container starts.
FROM node:24.22.1-bookworm-slim

ENV CI=true
RUN npm install -g pnpm@12.16.1 && npm cache clean --force

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/metadata/package.json packages/metadata/tsconfig.json packages/metadata/
COPY packages/metadata/src packages/metadata/src
COPY services/pin/package.json services/pin/
# node_modules holds hard links into the store, so dropping the store and the metadata cache keeps the packages.
RUN pnpm install --frozen-lockfile --filter "@proofchain/pin..." \
 && pnpm --dir packages/metadata build \
 && rm -rf /root/.cache/pnpm /root/.local/share/pnpm

COPY services/pin/src services/pin/src

ENV PIN_HOST=0.0.0.0 \
    PORT=8788 \
    IPFS_API_URL=http://ipfs:5001
USER node
EXPOSE 8788
CMD ["node", "--experimental-strip-types", "services/pin/src/main.ts"]
