FROM oven/bun:1.2-alpine AS base
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json bun.lock ./

FROM base AS prod-deps
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --production --frozen-lockfile

FROM base AS builder
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.2-alpine AS runtime
RUN apk add --no-cache su-exec
WORKDIR /app
RUN mkdir -p /app/data
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder   /app/build       ./build
COPY --from=builder   /app/drizzle     ./drizzle
COPY --from=builder   /app/package.json ./package.json
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV NODE_ENV=production
ENV PORT=6969
ENV DATABASE_PATH=/app/data/akaun.db
ENV STORAGE_PATH=/app/data/storage
ENV LOG_LEVEL=info
EXPOSE 6969
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO /dev/null http://localhost:6969/login || exit 1
ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "build/index.js"]
