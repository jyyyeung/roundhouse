import { EventEnvelope, ReduceContext, ReduceResult } from "@roundhouse/game-core";
import { scoreCategory } from "./score";
import { yahtzeeCategories, yatzyCategories } from "./categories";
import { Category, Dice, Ruleset } from "./types";

type Sheet = Record<string, number | null> & {
  bonus?: number | null;
};

type YatzyState = {
  tableId?: string;
  ruleset: Ruleset;
  playerIds: string[];
  currentPlayerIndex: number;
  rollsLeft: number;
  dice: number[];
  holds: boolean[];
  sheets: Record<string, Sheet>;
  phase: "playing" | "finished";
  winnerIds: string[];
};

const EMPTY_DICE: Dice = [0, 0, 0, 0, 0];
const EMPTY_HOLDS = [false, false, false, false, false];
const UPPER_CATEGORIES = ["ones", "twos", "threes", "fours", "fives", "sixes"] as const;

function categoriesFor(ruleset: Ruleset) {
  return ruleset === "yatzy" ? yatzyCategories : yahtzeeCategories;
}

function createSheet(ruleset: Ruleset): Sheet {
  return {
    ...Object.fromEntries(categoriesFor(ruleset).map((category) => [category, null])),
    bonus: null,
  };
}

function upperScore(sheet: Sheet) {
  return UPPER_CATEGORIES.reduce((sum, category) => sum + (sheet[category] ?? 0), 0);
}

function totalScore(ruleset: Ruleset, sheet: Sheet) {
  return categoriesFor(ruleset).reduce((sum, category) => sum + (sheet[category] ?? 0), 0) + (sheet.bonus ?? 0);
}

function currentPlayerId(state: YatzyState) {
  return state.playerIds[state.currentPlayerIndex];
}

function tableId(state: YatzyState) {
  return state.tableId ?? "yatzy";
}

function nextPlayerIndex(state: YatzyState) {
  return (state.currentPlayerIndex + 1) % state.playerIds.length;
}

function resetTurn(state: YatzyState, currentPlayerIndex = state.currentPlayerIndex): YatzyState {
  return {
    ...state,
    currentPlayerIndex,
    rollsLeft: 3,
    dice: [...EMPTY_DICE],
    holds: [...EMPTY_HOLDS],
  };
}

type Event = Omit<EventEnvelope, "id" | "seq" | "createdAt">;

function success(state: YatzyState, events: Event[]): ReduceResult {
  return { ok: true, state, events };
}

function fail(error: string): ReduceResult {
  return { ok: false, error };
}

function isValidHolds(value: unknown): value is boolean[] {
  return Array.isArray(value) && value.length === 5 && value.every((item) => typeof item === "boolean");
}

function isPlayerTurn(state: YatzyState, ctx: ReduceContext) {
  return ctx.actorId === currentPlayerId(state);
}

function ensureSheet(state: YatzyState, playerId: string) {
  return state.sheets[playerId] ?? createSheet(state.ruleset);
}

function cloneState(state: YatzyState): YatzyState {
  return {
    ...state,
    dice: [...state.dice],
    holds: [...state.holds],
    sheets: Object.fromEntries(
      Object.entries(state.sheets).map(([playerId, sheet]) => [
        playerId,
        { ...sheet },
      ])
    ),
  };
}

function applyBonus(sheet: Sheet) {
  if ((sheet.bonus ?? null) === 35) return sheet;
  return upperScore(sheet) >= 63 ? { ...sheet, bonus: 35 } : sheet;
}

function finishIfComplete(state: YatzyState) {
  const isComplete = state.playerIds.every((playerId) =>
    categoriesFor(state.ruleset).every((category) => state.sheets[playerId]?.[category] !== null)
  );

  if (!isComplete) return state;

  const scores = state.playerIds.map((playerId) =>
    totalScore(state.ruleset, state.sheets[playerId] ?? createSheet(state.ruleset))
  );
  const top = Math.max(...scores);
  return {
    ...state,
    phase: "finished",
    winnerIds: state.playerIds.filter((playerId, index) => scores[index] === top),
  };
}

export function reduce(state: unknown, intent: { type: string; payload: unknown }, ctx: ReduceContext): ReduceResult {
  const current = cloneState(state as YatzyState);

  if (current.phase === "finished") {
    return fail("game_finished");
  }

  if (!isPlayerTurn(current, ctx)) {
    return fail("not_your_turn");
  }

  if (intent.type === "roll") {
    if (current.rollsLeft <= 0) return fail("no_rolls_left");

    const dice = current.dice.map((value, index) =>
      current.holds[index] && value !== 0 ? value : ctx.randomInt(6) + 1
    );

    return success(
      {
        ...current,
        dice,
        rollsLeft: current.rollsLeft - 1,
      },
      [
        {
          actorId: ctx.actorId,
          tableId: tableId(current),
          gameId: "yatzy",
          payload: { dice: [...dice], rollsLeft: current.rollsLeft - 1 },
          type: "dice_rolled",
        },
      ]
    );
  }

  if (intent.type === "set_holds") {
    const holds = (intent.payload as { holds?: unknown }).holds;
    if (!isValidHolds(holds)) {
      return fail("illegal_holds");
    }

    return success(
      {
        ...current,
        holds: [...holds],
      },
      [
        {
          actorId: ctx.actorId,
          tableId: tableId(current),
          gameId: "yatzy",
          payload: { holds: [...holds] },
          type: "dice_held",
        },
      ]
    );
  }

  if (intent.type === "score") {
    if (current.dice.every((die) => die === 0)) return fail("must_roll_first");

    const category = (intent.payload as { category: string }).category;
    const sheet = ensureSheet(current, ctx.actorId);
    if (!(category in sheet)) return fail("invalid_category");
    if (sheet[category] !== null) return fail("category_taken");

    const score = scoreCategory(current.ruleset, category as Category, current.dice as Dice);
    const updatedSheet = applyBonus({
      ...sheet,
      [category]: score,
    });

    const nextState: YatzyState = {
      ...current,
      sheets: {
        ...current.sheets,
        [ctx.actorId]: updatedSheet,
      },
    };

    const advancedState = resetTurn(nextState, nextPlayerIndex(nextState));
    const finishedState = finishIfComplete(advancedState);
    const events: Event[] = [
      {
        actorId: ctx.actorId,
        tableId: tableId(current),
        gameId: "yatzy",
        payload: {
          category,
          nextPlayerId: currentPlayerId(advancedState),
          score,
        },
        type: "category_scored",
      },
      {
        actorId: ctx.actorId,
        tableId: tableId(current),
        gameId: "yatzy",
        payload: { currentPlayerId: currentPlayerId(advancedState) },
        type: "turn_advanced",
      },
    ];

    if (finishedState.phase === "finished") {
      events.push({
        actorId: ctx.actorId,
        tableId: tableId(current),
        gameId: "yatzy",
        payload: { winnerIds: finishedState.winnerIds },
        type: "game_finished",
      });
    }

    return { ok: true, state: finishedState, events };
  }

  return fail("unknown_intent");
}

// Replay primitives shared with `apply-event.ts`: folding an event has to use
// the same scoring and turn rules as reducing an intent, or replay drifts.
export { applyBonus, cloneState, createSheet, resetTurn };
export type { YatzyState, Sheet };
