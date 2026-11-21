import type { RawGameState, ViewerView } from "@roundhouse/game-core";

import type { YatzyState } from "./reduce";

/**
 * What a single client is allowed to see of a Yatzy game. This is the wire shape:
 * the web app is typed against it, never against `YatzyState`.
 */
export type YatzyView = {
  gameId: "yatzy";
  ruleset: YatzyState["ruleset"];
  playerIds: string[];
  currentPlayerId: string | null;
  dice: YatzyState["dice"];
  holds: YatzyState["holds"];
  rollsLeft: number;
  sheets: YatzyState["sheets"];
  phase: YatzyState["phase"];
  winnerIds: string[];
  /** Seat index of the viewer, or null when the viewer is not seated. */
  you: number | null;
};

/**
 * Yatzy has no hidden information, so every viewer sees the same board; only
 * `you` differs. Keeping the projection explicit means the interface is already
 * proven the day a module does have something to hide.
 */
export function projectYatzyView(state: RawGameState, viewer: ViewerView): YatzyView {
  const current = state as unknown as YatzyState;

  return {
    gameId: "yatzy",
    ruleset: current.ruleset,
    playerIds: current.playerIds,
    currentPlayerId: current.playerIds[current.currentPlayerIndex] ?? null,
    dice: current.dice,
    holds: current.holds,
    rollsLeft: current.rollsLeft,
    sheets: current.sheets,
    phase: current.phase,
    winnerIds: current.winnerIds,
    you: viewer.kind === "player" ? viewer.seatIndex : null,
  };
}
