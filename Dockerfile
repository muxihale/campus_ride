FROM oven/bun:1.4.0 AS bun-runtime

FROM node:24-bookworm-slim AS build
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Образы для локальной демонстрации; это не конфигурация продакшена.
FROM build AS api
EXPOSE 3001
CMD ["sh", "-c", "bun run db:deploy && bun run start:api"]

FROM build AS web
EXPOSE 5173
CMD ["bun", "run", "--filter", "@campusride/web", "preview", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
