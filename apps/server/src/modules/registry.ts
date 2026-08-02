import type { GameModule } from "@roundhouse/game-core";
import { yatzyModule } from "@roundhouse/game-yatzy";

const modules: Record<string, GameModule> = {
  [yatzyModule.id]: yatzyModule,
};

export function getModule(gameId: string): GameModule {
  const module = modules[gameId];
  if (!module) throw new Error(`unknown_game:${gameId}`);
  return module;
}
