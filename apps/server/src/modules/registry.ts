import type { GameCatalogueEntry, GameModule } from "@roundhouse/game-core";
import { duelModule } from "@roundhouse/game-duel";
import { yatzyModule } from "@roundhouse/game-yatzy";

/**
 * The only place a game is registered. Adding one means adding an import and an
 * entry here: config validation, seat limits, the lobby's game list and the
 * browser's view all follow from the module itself.
 */
const modules: Record<string, GameModule> = {
  [duelModule.id]: duelModule,
  [yatzyModule.id]: yatzyModule,
};

export function getModule(gameId: string): GameModule {
  const module = modules[gameId];
  if (!module) throw new Error(`unknown_game:${gameId}`);
  return module;
}

/** Every hostable game, in a stable order so the lobby does not shuffle. */
export function listModules(): GameModule[] {
  return Object.values(modules).sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * The `GET /api/games` payload: what a client needs to offer a game without
 * knowing anything about it. `configSchema` is deliberately absent — the schema
 * is a `z.ZodType`, not JSON; `defaultConfig` is the value it accepts.
 */
export function getGameCatalogue(): GameCatalogueEntry[] {
  return listModules().map((module) => ({
    defaultConfig: module.defaultConfig,
    displayName: module.displayName,
    id: module.id,
    playerCount: { max: module.playerCount.max, min: module.playerCount.min },
  }));
}
