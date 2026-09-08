# syntax=docker/dockerfile:1.7
# AgentGuard — single image running BOTH processes:
#   - sidecar  (Fastify API + WebSocket, :9559)
#   - dashboard (Vite static + /api reverse proxy, :5173 via launcher.js)
# Multi-arch: base images are arch-agnostic (linux/amd64 + linux/arm64).
#   docker buildx build --platform linux/amd64,linux/arm64 -t agentguard:0.1.0 .

# ─── Stage 1: build the whole workspace monorepo ────────────────────────────
FROM node:22-slim AS build
WORKDIR /build

# Manifests first for layer caching
COPY package.json package-lock.json tsconfig.base.json ./
COPY .npmrc ./
COPY packages/ ./packages/
COPY policies/ ./policies/

RUN npm ci --no-audit --no-fund

# npm runs workspaces name-sorted (not topologically): @agentguard/cli precedes
# @agentguard/sidecar alphabetically, and the CLI type-checks against the
# sidecar's dist. Build the dependency leaves first, then everything else.
RUN npm run build --workspace @agentguard/core --workspace @agentguard/sidecar
RUN npm run build --workspaces --if-present

# Strip dev dependencies (vite, tsx, typescript, vitest, …) from the image
RUN npm prune --omit=dev --no-audit --no-fund

# ─── Stage 2: production runtime ────────────────────────────────────────────
FROM node:22-slim AS runtime

# Non-root user + tini for proper signal handling
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 agentguard \
    && useradd -u 10001 -g agentguard -d /app -s /usr/sbin/nologin agentguard

WORKDIR /app

# Hoisted workspace dependencies (production only)
COPY --from=build --chown=agentguard:agentguard /build/node_modules ./node_modules
# Built workspace packages (dist + manifest so npm workspace symlinks resolve)
COPY --from=build --chown=agentguard:agentguard /build/packages/core ./packages/core
COPY --from=build --chown=agentguard:agentguard /build/packages/sidecar ./packages/sidecar
# Dashboard static build (served by launcher.js)
COPY --from=build --chown=agentguard:agentguard /build/packages/dashboard/dist ./dashboard/dist

# Entrypoint, default policy, writable data dir
COPY --chown=agentguard:agentguard launcher.js ./launcher.js
COPY --chown=agentguard:agentguard policies ./policies
RUN printf '{"name":"agentguard-app","private":true,"type":"module"}\n' > ./package.json \
    && mkdir -p /app/data \
    && chown -R agentguard:agentguard /app/data

USER agentguard

ENV NODE_ENV=production \
    AGENTGUARD_PORT=9559 \
    AGENTGUARD_DASHBOARD_PORT=5173 \
    AGENTGUARD_BIND_ALL=1 \
    AGENTGUARD_POLICY_FILE=/policies/agentguard.yaml \
    AGENTGUARD_TENANT_DATA_DIR=/data \
    AGENTGUARD_TENANT_POLICY_DIR=/policies

EXPOSE 9559 5173

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9559/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/launcher.js"]