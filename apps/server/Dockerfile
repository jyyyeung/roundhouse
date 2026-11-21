# One dependency install, shared by the workspace packages the server imports.
#
# `tsx` runs the TypeScript sources in production on purpose: workspace packages
# resolve to `src/index.ts`, so there is no separate compile step to ship. `tsx`
# is therefore a production dependency. Migrations are applied in-process at
# start-up (src/db/migrate.ts), so `drizzle-kit` stays a dev dependency.
#
# The runtime stage does not need pnpm: it runs the binaries in node_modules
# directly, which also means start-up needs no network and no package-manager
# cache that has to be warmed as the right user.
FROM node:22-alpine AS deps

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/game-core/package.json packages/game-core/package.json
COPY packages/game-testkit/package.json packages/game-testkit/package.json
COPY packages/games/yatzy/package.json packages/games/yatzy/package.json

# `...` pulls in the workspace dependencies of the server, and `--prod` drops
# test-only packages, so the runtime image carries no test tooling.
RUN pnpm install --frozen-lockfile --prod --filter "@roundhouse/server..."

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

# Same base image as `deps`, so the pnpm store layout (symlinked node_modules)
# copies across intact.
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/server/node_modules apps/server/node_modules
COPY --from=deps /app/packages packages
COPY --from=deps /app/package.json package.json
COPY --from=deps /app/pnpm-workspace.yaml pnpm-workspace.yaml
COPY --from=deps /app/tsconfig.base.json tsconfig.base.json

COPY apps/server apps/server
COPY packages/game-core packages/game-core
COPY packages/games/yatzy packages/games/yatzy

EXPOSE 3001

# Liveness only: a restart loop cannot fix an unreachable database, so the image
# probe keeps asking the cheap question. Compose overrides this with /ready.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

USER node

ENTRYPOINT ["./apps/server/docker-entrypoint.sh"]
