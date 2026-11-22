import { seatLabels } from "../lib/seats";

/**
 * Whose turn it is, read from the projected state rather than assumed.
 *
 * The view is public, so a game that publishes `currentPlayerId` gets a banner
 * and a game that does not (or a game whose turn is simultaneous, like Duel)
 * gets nothing — no branch on a game id, and no new state on the wire.
 *
 * The field is read structurally, not through a game type: the platform must not
 * know that yatzy exists (the `no-game-branch` guard rule enforces that).
 */
export function currentPlayerIdOf(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as { currentPlayerId?: unknown }).currentPlayerId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function TurnBanner({
  currentUserId,
  seatUserIds,
  state,
}: {
  currentUserId: string | null;
  seatUserIds: readonly string[];
  state: unknown;
}) {
  const currentPlayerId = currentPlayerIdOf(state);
  if (!currentPlayerId) return null;

  const labels = seatLabels(seatUserIds, currentUserId);
  const mine = currentUserId !== null && currentPlayerId === currentUserId;
  const who = labels[currentPlayerId] ?? "the next player";

  return (
    <p
      aria-live="polite"
      className={[
        "mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold",
        mine
          ? "bg-[var(--color-coral)] text-white"
          : "bg-white/80 text-[var(--color-ink)] shadow-sm",
      ].join(" ")}
      data-testid="turn-banner"
    >
      <span aria-hidden="true">{mine ? "●" : "…"}</span>
      {mine ? "Your turn" : `Waiting on ${who}`}
    </p>
  );
}
