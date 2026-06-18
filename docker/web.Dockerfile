# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
RUN apk add --no-cache libc6-compat && corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN pnpm --filter @betterspend/shared build \
  && pnpm --filter @betterspend/web build

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
RUN apk add --no-cache libc6-compat && addgroup -S betterspend && adduser -S betterspend -G betterspend
COPY --from=build --chown=betterspend:betterspend /repo/apps/web/.next/standalone ./
COPY --from=build --chown=betterspend:betterspend /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=betterspend:betterspend /repo/apps/web/public ./apps/web/public
USER betterspend
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
