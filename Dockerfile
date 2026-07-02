FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npx vite build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# litestream (Go) verifies TLS against the system trust store, which the
# slim image doesn't ship — node is unaffected (bundles its own CAs)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=litestream/litestream:0.3.13 /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
COPY package.json ./
COPY litestream.yml /etc/litestream.yml
EXPOSE 3001
CMD ["sh", "scripts/start.sh"]
