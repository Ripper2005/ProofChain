# Build context: the repository root. Dependencies are installed here, never when the container starts.
FROM node:24.22.1-bookworm-slim

ENV CI=true
RUN npm install -g pnpm@12.16.1 && npm cache clean --force

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY indexer/package.json indexer/
# node_modules holds hard links into the store, so dropping the store and the metadata cache keeps the packages.
RUN pnpm install --frozen-lockfile --prod --filter @proofchain/indexer \
 && rm -rf /root/.cache/pnpm /root/.local/share/pnpm

COPY indexer/migrations indexer/migrations
COPY indexer/src indexer/src

ENV INDEXER_HOST=0.0.0.0 \
    INDEXER_PORT=8787
USER node
EXPOSE 8787
CMD ["node", "--experimental-strip-types", "indexer/src/main.ts"]
