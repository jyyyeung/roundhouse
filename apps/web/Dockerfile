FROM node:22-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/game-core/package.json packages/game-core/package.json
COPY packages/games/yatzy/package.json packages/games/yatzy/package.json

RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/game-core packages/game-core
COPY packages/games/yatzy packages/games/yatzy

RUN pnpm --filter @roundhouse/web build

FROM nginx:1.29-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
