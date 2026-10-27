FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --no-audit --no-fund

# Surfpool is a local execution VM, never a remote transaction relay.
# Pin both the official release and its GitHub-published archive digest.
FROM debian:bookworm-slim AS rehearsal-runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libssl3 libstdc++6 \
    && curl --fail --silent --show-error --location \
      https://github.com/solana-foundation/surfpool/releases/download/v1.6.1/surfpool-linux-x64.tar.gz \
      --output /tmp/surfpool.tar.gz \
    && echo '64cff3fd6bb00bb0d5c7edef2915a491338d14eb19b7130abf9c81ee5357d165  /tmp/surfpool.tar.gz' | sha256sum --check - \
    && tar -xzf /tmp/surfpool.tar.gz -C /usr/local/bin surfpool \
    && chmod 0555 /usr/local/bin/surfpool \
    && /usr/local/bin/surfpool --version \
    && rm -rf /var/lib/apt/lists/* /tmp/surfpool.tar.gz

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# Generate Next's ignored route declarations before checking a clean checkout.
# These release gates run in Railway's builder, independently of GitHub Actions.
RUN npx next typegen --webpack \
    && npm run typecheck \
    && npm run lint \
    && npm run test:run -- --maxWorkers=2 \
    && npm audit --omit=dev --audit-level=low \
    && npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=rehearsal-runtime /usr/local/bin/surfpool /usr/local/bin/surfpool
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/docker-entrypoint.mjs ./docker-entrypoint.mjs
# Bootstrap volume ownership, then drop privileges before starting the application.
USER root
EXPOSE 3000
CMD ["node", "docker-entrypoint.mjs"]
