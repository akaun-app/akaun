FROM oven/bun:1-alpine AS base
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json bun.lock ./

FROM base AS prod-deps
RUN --mount=type=cache,target=/root/.bun bun install --production --frozen-lockfile

FROM base AS builder
RUN --mount=type=cache,target=/root/.bun bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-alpine AS runtime
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./package.json
ENV NODE_ENV=production
ENV PORT=6969
ENV DATABASE_PATH=/app/data/akaun.db
ENV STORAGE_PATH=/app/data/storage
ENV LOG_LEVEL=info
EXPOSE 6969
CMD ["bun", "build/index.js"]
