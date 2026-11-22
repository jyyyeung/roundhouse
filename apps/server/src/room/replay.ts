import type {
  EventEnvelope,
  GameModule,
  Json,
  ReplayTurn,
  ViewerView,
} from "@roundhouse/game-core";

import { projectReplayedState } from "./projection";

export type BuildReplayInput = {
  module: GameModule;
  /** State the game started from, rebuilt from the table's config and seats. */
  initialState: Json;
  events: readonly EventEnvelope[];
  viewer: ViewerView;
};

/** What a module that does not describe its own events falls back to. */
function humanizeEventType(type: string): string {
  return type.replace(/_/g, " ");
}

/**
 * Folds a finished game's log into a sequence of views (ADR 0009).
 *
 * The returned turns are what a scrubber walks: one step per event the game
 * considers an action, each carrying the state **some viewer** was entitled to
 * see after that event. Event envelopes never leave this function, so a payload
 * holding an unrevealed pick cannot reach a client through replay.
 *
 * Folding from the initial state costs one `applyEvent` per event. A game is
 * tens of events; past a few thousand a checkpoint table would earn its
 * migration, and `replay.test.ts` puts a ceiling on the cost we accept today.
 */
export function buildReplay({
  module,
  initialState,
  events,
  viewer,
}: BuildReplayInput): ReplayTurn[] {
  const turns: ReplayTurn[] = [];
  let state = initialState;

  for (const event of events) {
    state = module.applyEvent(state, event);
    const described = module.describeEvent
      ? module.describeEvent(event)
      : humanizeEventType(event.type);
    // `null` means bookkeeping (a turn handoff). Skipping it keeps every
    // scrubber step something a player did.
    if (described === null) continue;
    turns.push({
      actorId: event.actorId,
      phrase: described,
      seq: event.seq,
      view: projectReplayedState(module, state, viewer),
    });
  }

  const lastEvent = events.at(-1);
  // The final board must always be reachable, even when the last event was
  // bookkeeping, and even for a game whose log is empty.
  if (!lastEvent) {
    return [
      {
        actorId: null,
        phrase: "game started",
        seq: 0,
        view: projectReplayedState(module, state, viewer),
      },
    ];
  }
  if (turns.at(-1)?.seq !== lastEvent.seq) {
    turns.push({
      actorId: lastEvent.actorId,
      phrase: "final position",
      seq: lastEvent.seq,
      view: projectReplayedState(module, state, viewer),
    });
  }

  return turns;
}
