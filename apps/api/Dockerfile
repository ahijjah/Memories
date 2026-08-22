# Build context is the monorepo root (see infra/docker-compose.prod.yml:
# "context: .", "dockerfile: apps/api/Dockerfile") because apps/api
# depends on the packages/ai workspace package.

FROM node:20-slim AS builder
WORKDIR /repo

COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/domain/package.json packages/domain/package.json

RUN npm install

COPY apps/api apps/api
COPY packages packages

RUN npm run prisma:generate --workspace=apps/api
RUN npm run build --workspace=apps/api

FROM node:20-slim AS runner
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/domain/package.json packages/domain/package.json

RUN npm install --omit=dev

COPY --from=builder /repo/apps/api/dist apps/api/dist
COPY --from=builder /repo/apps/api/prisma apps/api/prisma
COPY --from=builder /repo/apps/api/node_modules/.prisma apps/api/node_modules/.prisma
COPY packages packages

WORKDIR /repo/apps/api
EXPOSE 3000

CMD ["node", "dist/main.js"]
