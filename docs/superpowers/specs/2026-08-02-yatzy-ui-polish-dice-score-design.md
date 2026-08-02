# Yatzy table UI polish — dice faces & score previews

Date: 2026-08-02  
Status: approved for planning

## Goal

Tighten table UI details without changing the overall theme:

1. Replace roman-numeral die faces with actual pip dice (soft style).
2. Simplify score-sheet cells so open rows show the expected score (or a quiet dash), not “Open / Would score …”.

## Decisions

| Topic | Choice |
|---|---|
| Unscored, no preview | Em dash `—` |
| Unscored, with preview | Preview number only |
| Scored | Existing locked number |
| Die style | Soft pips (bevel/gradient + CSS pip grid) |
| Architecture | Shared `DieFace` with `variant: "soft" \| "classic"` (default `"soft"`) |
| Unicode dice | Explicitly out — not a variant |
| Style picker / persistence | Deferred follow-up |
| Chat snapshot dice | Out of scope for this pass |

## Design

### `DieFace`

New component: `apps/web/src/games/yatzy/DieFace.tsx`

- Props: `value: number` (0–6), optional `variant?: "soft" | "classic"` (default `"soft"`).
- Soft: 3×3 pip grid with subtle bevel/gradient matching the brainstorm mockup “C”.
- Classic: flat pip tile (same layout, no bevel) — present as a branch so a future user preference can switch without restructuring.
- `value === 0`: empty face, same chrome, no pips.
- Hold/roll interaction and teal held styling remain on the outer `DiceTray` button; `DieFace` only draws the face.

### `DiceTray`

- Remove `DIE_FACES` roman map.
- Render `<DieFace value={value} />` inside each die button.
- Keep existing motion, hold toggle, and disabled behavior.

### `ScoreSheet`

Each category cell shows a single primary label:

- If scored → locked value.
- Else if clickable and `previewScore` is non-null → that number.
- Else → `—`.

No subtitle. Existing background classes continue to signal clickable vs locked vs inactive. Update `aria-label` to include the shown value when relevant (e.g. preview).

## Out of scope

- User-selectable die style UI and persistence.
- Rewriting chat snapshot dice display (may reuse `DieFace` later).
- Scoring rules, intents, or server changes.

## Verification

- Update web tests that assert `"Open"`, `"Would score"`, or roman faces.
- Run web unit tests.
- Manual check: dice tray shows soft pips; score sheet shows preview numbers / `—` only.
