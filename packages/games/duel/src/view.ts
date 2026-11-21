import type { RawGameState, ViewerView } from "@roundhouse/game-core";

import type { DuelCard, DuelRound, DuelState } from "./reduce";

/**
 * What one client may see of a duel. This is the wire shape, and it is the whole
 * point of the game: `yourPick` is the viewer's own pending card, while the
 * opponent's pending card has no field to live in. Nothing else in the view can
 * carry it — `pickedBy` is a list of player ids, and `rounds` only holds rounds
 * that have already been revealed to both players.
 */
export type DuelView = {
  gameId: "duel";
  phase: DuelState["phase"];
  /** 1-based; one past `totalRounds` once the match is over. */
  round: number;
  totalRounds: number;
  playerIds: string[];
  /** Seat index of the viewer, or null when the viewer is not seated. */
  you: number | null;
  /** The viewer's own pick this round, null when they have not picked or are watching. */
  yourPick: DuelCard | null;
  /** Player ids that have already picked this round — visible, deliberately: tempo is public. */
  pickedBy: string[];
  rounds: DuelRound[];
  scores: Record<string, number>;
  winnerIds: string[];
  decidedBy: DuelState["decidedBy"];
};

/** Copies a revealed round so a caller cannot reach back into server state. */
function publicRound(round: DuelRound): DuelRound {
  return {
    plays: round.plays.map((play) => ({ card: play.card, playerId: play.playerId })),
    round: round.round,
    winnerId: round.winnerId,
  };
}

export function projectDuelView(state: RawGameState, viewer: ViewerView): DuelView {
  const current = state as unknown as DuelState;
  // A seat index with no player behind it is not a seat: the row can exist before
  // the table does, and reporting a seat the game never filled would let a client
  // claim one.
  const candidate = viewer.kind === "player" && viewer.seatIndex >= 0 ? viewer.seatIndex : null;
  const viewerId = candidate === null ? null : (current.playerIds[candidate] ?? null);
  const seat = viewerId === null ? null : candidate;
  const pending = current.pending ?? {};

  return {
    gameId: "duel",
    phase: current.phase,
    round: current.round,
    totalRounds: current.totalRounds,
    playerIds: [...current.playerIds],
    you: seat,
    yourPick: viewerId === null ? null : (pending[viewerId] ?? null),
    // Seat order, not pick order: two viewers must render the same "picked" list.
    pickedBy: current.playerIds.filter((playerId) => pending[playerId] !== undefined),
    rounds: current.rounds.map(publicRound),
    scores: { ...current.scores },
    winnerIds: [...current.winnerIds],
    decidedBy: current.decidedBy,
  };
}
