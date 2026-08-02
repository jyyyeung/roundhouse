import type { GameModule } from "@yatzy/game-core";
import { yatzyModule } from "@yatzy/game-yatzy";

const modules: Record<string, GameModule> = {
  [yatzyModule.id]: yatzyModule,
};

export function getModule(gameId: string): GameModule {
  const module = modules[gameId];
  if (!module) throw new Error(`unknown_game:${gameId}`);
  return module;
}
