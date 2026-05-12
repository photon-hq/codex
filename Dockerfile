ARG BUN_VERSION=1.3
ARG NODE_VERSION=22

FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM oven/bun:${BUN_VERSION}-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM oven/bun:${BUN_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    PROCESS=webapp

RUN apk add --no-cache nodejs ca-certificates tini \
 && addgroup -S app && adduser -S -G app app

COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public

COPY --from=builder --chown=app:app /app/bridge ./bridge
COPY --from=builder --chown=app:app /app/lib ./lib
COPY --from=builder --chown=app:app /app/db ./db
COPY --from=builder --chown=app:app /app/scripts ./scripts
COPY --from=builder --chown=app:app /app/node_modules ./bridge-node_modules
COPY --from=builder --chown=app:app /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=app:app /app/package.json ./package.json

RUN ln -s /app/bridge-node_modules /app/node_modules || true

USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "scripts/entrypoint.ts"]
