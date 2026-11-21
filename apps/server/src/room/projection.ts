import type { GameModule, Json, RawGameState, ViewerView } from "@roundhouse/game-core";

/** The viewer for a user, given the table's seat order. */
export function viewerForUser(seatUserIds: readonly string[], userId: string | null): ViewerView {
  if (userId === null) return { kind: "spectator", userId: null };

  const seatIndex = seatUserIds.indexOf(userId);
  if (seatIndex === -1) return { kind: "spectator", userId };

  return { kind: "player", seatIndex, userId };
}

/**
 * The single seam where stored module state becomes a client-visible payload.
 * Everything that crosses the wire goes through here, so state a viewer may not
 * see cannot leak by accident somewhere else in the server.
 */
export function projectSnapshot(
  module: GameModule,
  state: RawGameState | null,
  viewer: ViewerView,
): Json {
  if (state === null) return null;
  return module.projectStateFor(state, viewer);
}

/**
 * `projectStateFor` is the only consumer of `RawGameState`, so the cast from the
 * `jsonb` column lives here next to it instead of at every call site.
 */
export function rawGameState(state: unknown): RawGameState | null {
  return (state ?? null) as RawGameState | null;
}
