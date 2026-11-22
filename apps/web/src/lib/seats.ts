/**
 * Seats are strings, but people need names and faces.
 *
 * Seat labels used to be derived twice — once in `routes/table.tsx` and once in
 * `games/yatzy/YatzyTable.tsx` — with the same rule copied by hand, so a change
 * to one (a real display name, say) would have made the lobby and the board
 * disagree about who is who. One implementation, both callers.
 *
 * Avatars are generated, not uploaded: initials from the id plus a hue from a
 * hash of it, so the same player is the same colour on every device and after a
 * reload, with no storage and no asset pipeline.
 */

/** "You" for the viewer, "Player N" for everyone else, in seat order. */
export function seatLabels(
  seatUserIds: readonly string[],
  currentUserId: string | null,
): Record<string, string> {
  const labels: Record<string, string> = {};
  seatUserIds.forEach((userId, index) => {
    labels[userId] = userId === currentUserId ? "You" : `Player ${index + 1}`;
  });
  return labels;
}

export type SeatAvatar = {
  /** 0-359; feeds `hsl(<hue> 70% 45%)` so a pair of players never looks identical. */
  hue: number;
  initials: string;
};

/** FNV-1a, 32-bit: small, stable across engines, and enough for a hue. */
function hashId(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function avatarFor(userId: string): SeatAvatar {
  const letters = userId.replace(/[^a-z0-9]/gi, "");
  const initials = (letters.slice(0, 2) || "?").toUpperCase();
  return { hue: hashId(userId) % 360, initials };
}

/** The inline style an avatar chip needs, kept here so every chip matches. */
export function avatarStyle(userId: string): { backgroundColor: string } {
  return { backgroundColor: `hsl(${avatarFor(userId).hue} 70% 45%)` };
}
