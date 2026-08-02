FROM node:22-alpine

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/game-core/package.json packages/game-core/package.json
COPY packages/games/yatzy/package.json packages/games/yatzy/package.json

RUN pnpm install --frozen-lockfile

COPY apps/server apps/server
COPY packages/game-core packages/game-core
COPY packages/games/yatzy packages/games/yatzy

EXPOSE 3001

CMD ["pnpm", "--filter", "@yatzy/server", "exec", "tsx", "src/index.ts"]
