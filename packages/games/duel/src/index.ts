export { type DuelConfig, defaultDuelConfig, duelConfigSchema, duelPlayerCount } from "./config";
export { duelIntents } from "./intents";
export { duelModule } from "./module";
export {
  createDuelState,
  DUEL_CARDS,
  type DuelCard,
  type DuelPlay,
  type DuelRound,
  type DuelState,
  reduce,
  roundWinner,
} from "./reduce";
export { type DuelView, projectDuelView } from "./view";
