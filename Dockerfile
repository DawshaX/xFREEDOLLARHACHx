# ─────────────────────────────────────────────────────────────────────────────
# CyberNova / NOVA — single-image build
#
#   docker build -t cybernova .
#   docker run -p 8080:8080 -v nova-state:/app/state cybernova
#
# The image contains the agent API (port 8080) AND the built panel, served by the
# API process itself on /, so one container == the whole program.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /app

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY lib/db/package.json ./lib/db/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/kali-panel/package.json ./artifacts/kali-panel/
RUN pnpm install --frozen-lockfile --ignore-scripts || pnpm install --no-frozen-lockfile --ignore-scripts

# ── build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
ENV NODE_ENV=production
RUN pnpm --filter @workspace/api-server run build \
 && BASE_PATH=/ pnpm --filter @workspace/kali-panel run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    NOVA_MEMORY_FILE=/data/nova-memory.json
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/lib ./lib
COPY --from=build /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=build /app/artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY --from=build /app/artifacts/api-server/state ./artifacts/api-server/state
COPY --from=build /app/artifacts/kali-panel/dist/public ./artifacts/kali-panel/dist/public

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
