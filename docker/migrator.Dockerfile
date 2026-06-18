# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION}
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile
COPY packages/db packages/db
CMD ["pnpm", "--filter", "@betterspend/db", "db:migrate"]
