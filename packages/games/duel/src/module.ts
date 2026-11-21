import type {
  EventEnvelope,
  GameModule,
  Json,
  RawGameState,
  ViewerView,
} from "@roundhouse/game-core";

import { applyDuelEvent } from "./apply-event";
import { defaultDuelConfig, duelConfigSchema, duelPlayerCount } from "./config";
import { duelIntents } from "./intents";
import { createDuelState, type DuelState, reduce } from "./reduce";
import { projectDuelView } from "./view";

function projectStateFor(state: RawGameState, viewer: ViewerView) {
  return projectDuelView(state, viewer) as unknown as Json;
}

function applyEvent(state: Json, event: EventEnvelope) {
  return applyDuelEvent(state, event) as unknown as Json;
}

function isFinished(state: Json) {
  return (state as DuelState).phase === "finished";
}

export const duelModule: GameModule = {
  id: "duel",
  displayName: "Duel",
  playerCount: duelPlayerCount,
  defaultConfig: defaultDuelConfig,
  configSchema: duelConfigSchema,
  intents: duelIntents,
  createInitialState: createDuelState,
  reduce,
  projectStateFor,
  applyEvent,
  isFinished,
};
