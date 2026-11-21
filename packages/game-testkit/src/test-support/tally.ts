import type {
  EventEnvelope,
  GameModule,
  Json,
  RawGameState,
  ReduceContext,
  ReduceResult,
  ViewerView,
} from "@roundhouse/game-core";

/**
 * The smallest game that can satisfy the conformance suite: N players take turns
 * tapping, the highest tap count wins after a fixed number of rounds.
 *
 * It exists so the testkit can prove its own suite is not yatzy-shaped, and so
 * the leak check can be pointed at a module that deliberately leaks. It is not
 * shipped anywhere.
 */

export type TallyState = {
  gameId: "tally";
  playerIds: string[];
  currentPlayerIndex: number;
  taps: Record<string, number>;
  roundsLeft: number;
  phase: "playing" | "finished";
  winnerIds: string[];
  secret?: string;
};

export type TallyLeak = "none" | "everyone" | "owner-only";

export type TallyView = {
  gameId: "tally";
  playerIds: string[];
  currentPlayerId: string | null;
  taps: Record<string, number>;
  roundsLeft: number;
  phase: "playing" | "finished";
  winnerIds: string[];
  you: number | null;
  secret?: string;
};

const ROUNDS = 3;

function currentPlayerId(state: TallyState): string | null {
  return state.playerIds[state.currentPlayerIndex] ?? null;
}

function finish(state: TallyState): TallyState {
  const scores = state.playerIds.map((playerId) => state.taps[playerId] ?? 0);
  const top = Math.max(...scores);
  return {
    ...state,
    phase: "finished",
    winnerIds: state.playerIds.filter((_playerId, index) => scores[index] === top),
  };
}

function project(state: RawGameState, viewer: ViewerView, leak: TallyLeak): TallyView {
  const raw = state as unknown as TallyState;
  const view: TallyView = {
    gameId: "tally",
    playerIds: raw.playerIds,
    currentPlayerId: raw.phase === "finished" ? null : currentPlayerId(raw),
    taps: raw.taps,
    roundsLeft: raw.roundsLeft,
    phase: raw.phase,
    winnerIds: raw.winnerIds,
    you: viewer.kind === "player" && viewer.seatIndex >= 0 ? viewer.seatIndex : null,
  };

  const leaks =
    leak === "everyone" ||
    (leak === "owner-only" && viewer.kind === "player" && viewer.userId === raw.playerIds[0]);

  return leaks && raw.secret !== undefined ? { ...view, secret: raw.secret } : view;
}

export function makeTallyModule(leak: TallyLeak = "none"): GameModule {
  return {
    id: "tally",
    displayName: "Tally",
    intents: {},

    createInitialState(_config: Json, playerIds: string[]): Json {
      return {
        gameId: "tally",
        playerIds,
        currentPlayerIndex: 0,
        taps: Object.fromEntries(playerIds.map((playerId) => [playerId, 0])),
        roundsLeft: ROUNDS,
        phase: "playing",
        winnerIds: [],
      } satisfies TallyState;
    },

    reduce(state: Json, intent: { type: string; payload: Json }, ctx: ReduceContext): ReduceResult {
      const current = state as TallyState;

      if (current.phase === "finished") return { ok: false, error: "game_finished" };
      if (ctx.actorId !== currentPlayerId(current)) return { ok: false, error: "not_your_turn" };
      if (intent.type !== "tap") return { ok: false, error: "unknown_intent" };

      const taps = { ...current.taps, [ctx.actorId]: (current.taps[ctx.actorId] ?? 0) + 1 };
      const wrapped = current.currentPlayerIndex + 1 >= current.playerIds.length;
      const next: TallyState = {
        ...current,
        taps,
        currentPlayerIndex: (current.currentPlayerIndex + 1) % current.playerIds.length,
        roundsLeft: wrapped ? current.roundsLeft - 1 : current.roundsLeft,
      };

      const events: Omit<EventEnvelope, "id" | "seq" | "createdAt">[] = [
        {
          tableId: "tally-table",
          gameId: "tally",
          type: "tapped",
          actorId: ctx.actorId,
          payload: {
            playerId: ctx.actorId,
            taps: taps[ctx.actorId] ?? 0,
            // Everything replay needs is in the event (ADR 0002): a field the fold
            // cannot recover from the payload is a field the log loses.
            currentPlayerIndex: next.currentPlayerIndex,
            roundsLeft: next.roundsLeft,
          },
        },
      ];

      if (next.roundsLeft <= 0) {
        const finished = finish(next);
        events.push({
          tableId: "tally-table",
          gameId: "tally",
          type: "game_finished",
          actorId: null,
          payload: { winnerIds: finished.winnerIds },
        });
        return { ok: true, state: finished, events };
      }

      return { ok: true, state: next, events };
    },

    applyEvent(state: Json, event: EventEnvelope): Json {
      const current = state as TallyState;

      if (event.type === "tapped") {
        const payload = event.payload as {
          playerId?: string;
          taps?: number;
          currentPlayerIndex?: number;
          roundsLeft?: number;
        };
        if (
          typeof payload.playerId !== "string" ||
          typeof payload.taps !== "number" ||
          typeof payload.currentPlayerIndex !== "number" ||
          typeof payload.roundsLeft !== "number"
        ) {
          return state;
        }
        return {
          ...current,
          taps: { ...current.taps, [payload.playerId]: payload.taps },
          currentPlayerIndex: payload.currentPlayerIndex,
          roundsLeft: payload.roundsLeft,
        };
      }

      if (event.type === "game_finished") {
        const payload = event.payload as { winnerIds?: string[] };
        if (!Array.isArray(payload.winnerIds)) return state;
        return finish({ ...current, winnerIds: payload.winnerIds });
      }

      return state;
    },

    projectStateFor(state: RawGameState, viewer: ViewerView): Json {
      return project(state, viewer, leak) as unknown as Json;
    },

    isFinished(state: Json): boolean {
      return (state as TallyState).phase === "finished";
    },
  };
}
