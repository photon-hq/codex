ARG BUN_VERSION=1.3

FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM oven/bun:${BUN_VERSION}-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

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

RUN apk add --no-cache tini ca-certificates \
 && addgroup -S app && adduser -S -G app app

COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/bridge ./bridge
COPY --from=builder --chown=app:app /app/lib ./lib
COPY --from=builder --chown=app:app /app/db ./db
COPY --from=builder --chown=app:app /app/scripts ./scripts
COPY --from=builder --chown=app:app /app/next.config.ts ./
COPY --from=builder --chown=app:app /app/drizzle.config.ts ./
COPY --from=builder --chown=app:app /app/tsconfig.json ./
COPY --chown=app:app package.json ./

USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "scripts/entrypoint.ts"]
