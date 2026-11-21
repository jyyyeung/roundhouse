export const SAFE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateInviteCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of bytes) {
    out += SAFE_ALPHABET.charAt(byte % SAFE_ALPHABET.length);
  }
  return out;
}
