FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

# mongodump (mongodb-database-tools) + pg_dump (postgresql-client) + ca-certs
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg postgresql-client \
    && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/mongodb.gpg] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" > /etc/apt/sources.list.d/mongodb.list \
    && apt-get update && apt-get install -y --no-install-recommends mongodb-database-tools \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

FROM base AS build
COPY package.json pnpm-lock.yaml* ./
RUN pnpm config set strict-dep-builds false && pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=13280
COPY --from=build /app/.output ./.output
COPY --from=build /app/package.json ./package.json
EXPOSE 13280
CMD ["node", ".output/server/index.mjs"]
