import { GameModule, Json } from "@yatzy/game-core";
import { yahtzeeCategories, yatzyCategories } from "./categories";
import { reduce, type YatzyState } from "./reduce";
import { Ruleset } from "./types";

function categoriesFor(ruleset: Ruleset) {
  return ruleset === "yatzy" ? yatzyCategories : yahtzeeCategories;
}

function emptySheet(ruleset: Ruleset) {
  return {
    ...Object.fromEntries(categoriesFor(ruleset).map((category) => [category, null])),
    bonus: null,
  };
}

function createInitialState(config: Json, playerIds: string[]) {
  const { ruleset = "yatzy", tableId = "yatzy" } = (config as { ruleset?: Ruleset; tableId?: string }) ?? {};

  return {
    tableId,
    ruleset: ruleset as Ruleset,
    playerIds,
    currentPlayerIndex: 0,
    rollsLeft: 3,
    dice: [0, 0, 0, 0, 0],
    holds: [false, false, false, false, false],
    sheets: Object.fromEntries(playerIds.map((playerId) => [playerId, emptySheet(ruleset)])),
    phase: "playing" as const,
    winnerIds: [],
  } satisfies YatzyState;
}

function getPublicSnapshot(state: Json) {
  const current = state as YatzyState;

  return {
    gameId: "yatzy",
    ruleset: current.ruleset,
    dice: current.dice,
    holds: current.holds,
    rollsLeft: current.rollsLeft,
    currentPlayerId: current.playerIds[current.currentPlayerIndex],
    sheets: current.sheets,
    phase: current.phase,
    winnerIds: current.winnerIds,
  };
}

function isFinished(state: Json) {
  return (state as YatzyState).phase === "finished";
}

export const yatzyModule: GameModule = {
  id: "yatzy",
  displayName: "Yatzy",
  createInitialState,
  reduce,
  getPublicSnapshot,
  isFinished,
};
