# Score sheet category help tips

Date: 2026-08-09  
Status: approved for planning

## Goal

Players looking at the Yatzy/Yahtzee score sheet have no in-product explanation of what each category means or how it scores. Preview numbers alone don’t teach the rules.

Add a compact ⓘ affordance next to each category label and the Upper total / Bonus / Total footers. On fine-pointer devices, hover (and focus) shows a static explanation including score calculation and a fixed example. On touch, tap toggles the same tip.

## Decisions

| Topic | Choice |
|---|---|
| Affordance | ⓘ button beside label (does not own score-cell clicks) |
| Content | Static only — what + how scored + fixed example |
| Live dice preview | No (scoreboard cells already show current preview) |
| Scope | All categories for active ruleset + Upper total + Bonus + Total |
| UI chrome | Lightweight custom popover, no new deps |
| Copy location | Web-only `categoryHelp.ts` (not in `@roundhouse/game-yatzy`) |
| Portal | Tip portals to `document.body` to avoid sheet overflow clipping |

## Design

### Interaction

- Label cell layout: `[Name] [ⓘ]` for every category row and for Upper total, Bonus, Total.
- Fine pointer: open on hover/focus of ⓘ; close on leave with a short (~100–150ms) grace so the pointer can enter the tip; Esc and outside click also close.
- Coarse pointer / touch: tap ⓘ toggles; no hover-open.
- At most one tip open. Opening another closes the previous. Second tap on the same ⓘ closes.
- Score cells unchanged: still click-to-score when eligible.

### Content shape

Each help entry:

```ts
type CategoryHelp = {
  title: string;
  what: string;
  score: string;
  example: string;
};
```

Rendered in the tip as title + three short lines (What / Score / Example). No current-roll values.

Ruleset-aware: Yatzy and Yahtzee diverge where `packages/games/yatzy/src/score.ts` diverges (pairs only in Yatzy; kinds/straights/full house scoring differ). Upper faces share one template (“sum of all N faces”).

Footer copy (static):

- **Upper total** — sum of ones–sixes only; example as short arithmetic toward the bonus threshold.
- **Bonus** — if upper ≥ 63 → 35, else 0.
- **Total** — sum of all filled category scores + bonus.

Examples for categories use a fixed dice line and resulting score consistent with `scoreCategory` for that ruleset (e.g. Ones: `1-1-1-2-3 → 3`).

### Components & files

| Piece | Path | Role |
|---|---|---|
| `InfoTip` | `apps/web/src/games/yatzy/InfoTip.tsx` | ⓘ + popover: pointer-mode behavior, one-open, Esc/outside dismiss, basic flip when clipped |
| Help map | `apps/web/src/games/yatzy/categoryHelp.ts` | Lookup by ruleset + key (`Category` \| `"upper_total"` \| `"bonus"` \| `"total"`) |
| Sheet wiring | `apps/web/src/games/yatzy/ScoreSheet.tsx` | Place ⓘ on labels; pass `state.ruleset` into lookup |

No changes to scoring, reducer, or protocol.

### Accessibility

- ⓘ is a real `button` with `aria-label` like `About Ones` / `About Bonus`.
- Fine pointer: tip uses `role="tooltip"` associated via `aria-describedby` while open.
- Coarse pointer: toggle with `aria-expanded`; tip uses `role="dialog"` (or equivalent toggle panel) so it stays open until dismissed.

### Completeness guard

Unit test (or similar assert): for each ruleset, every id in `categoriesFor(ruleset)` plus `upper_total`, `bonus`, `total` has a help entry. Prevents shipping a missing tip.

## Out of scope

- Live “with your dice” calculations inside the tip.
- New tooltip library / Radix / Headless UI.
- Moving help strings into `@roundhouse/game-yatzy`.
- Explaining hold / roll / turn flow (dice tray UX).
- Changing bonus threshold or scoring formulas.

## Verification

- Manual desktop: hover ⓘ on a category and on Bonus; tip shows what/score/example; leave closes; score cell still scores.
- Manual mobile / coarse: tap opens, tap outside or again closes; no accidental score from tip.
- Switch ruleset (Yatzy vs Yahtzee): pair tips only on Yatzy; straight/full house/kind text matches that ruleset’s scoring.
- Completeness unit test for help map coverage.
- Existing score-sheet click-to-score tests still pass.
