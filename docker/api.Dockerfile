# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/api apps/api
COPY packages/db packages/db
COPY packages/shared packages/shared
RUN pnpm --filter @betterspend/shared build \
  && pnpm --filter @betterspend/db build \
  && pnpm --filter @betterspend/api build \
  && pnpm --filter @betterspend/api deploy --legacy --prod /out

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV API_PORT=4001
WORKDIR /app
RUN addgroup -S betterspend && adduser -S betterspend -G betterspend
COPY --from=build --chown=betterspend:betterspend /out/ ./
USER betterspend
EXPOSE 4001
CMD ["node", "dist/main.js"]
