# Score sheet category help tips

Date: 2026-08-09  
Status: approved for planning

## Goal

Players looking at the Yatzy/Yahtzee score sheet have no in-product explanation of what each category means or how it scores. Preview numbers alone don’t teach the rules.

Add a compact ⓘ affordance next to each category label and the Upper total / Bonus / Total footers. On fine-pointer devices, hover (and focus) shows a static explanation including score calculation and a fixed example. On touch, tap toggles the same tip.

Establish a shared tip primitive so other surfaces (lobby, dice tray, settings, etc.) can reuse the same interaction and styling later.

## Decisions

| Topic | Choice |
|---|---|
| Affordance | ⓘ button beside label (does not own score-cell clicks) |
| Content | Static only — what + how scored + fixed example |
| Live dice preview | No (scoreboard cells already show current preview) |
| Scope | All categories for active ruleset + Upper total + Bonus + Total |
| UI chrome | Shared `InfoTip` built on `@radix-ui/react-popover` |
| Why Popover not Tooltip | Mobile needs click-to-toggle; Tooltip is hover-centric. Popover is the right primitive; hover-open is layered for fine pointers |
| Copy location | Structured help data in `@roundhouse/game-yatzy` (plain strings / pure lookup — no React). Web only renders. Future games export the same shape from their packages. |
| Portal / positioning | Radix portal + collision (flip/shift) so sticky/overflow score sheet does not clip tips |

## Design

### Shared `InfoTip` primitive

Path: `apps/web/src/ui/InfoTip.tsx`

App-wide reusable control (not Yatzy-specific):

- Trigger: compact ⓘ (or optional custom trigger slot) — real `button` with caller-supplied `aria-label` / `label`.
- Content: `ReactNode` (callers own copy layout).
- Open behavior:
  - Fine pointer (`matchMedia('(hover: hover) and (pointer: fine)')`): open on hover/focus; close on leave with ~100–150ms grace so pointer can enter the panel; Esc / outside dismiss.
  - Coarse / touch: click toggles; no hover-open; Esc / outside / second click closes.
- Controlled by Radix `Popover` (`Root` / `Trigger` / `Portal` / `Content`). Style content with existing Tailwind tokens (cream/ink/coral borders, rounded, shadow) so tips match the product.
- Only one tip needs to feel exclusive in a dense sheet: prefer closing on outside interaction (Radix default); no global tip registry required for v1.
- Export from a thin `apps/web/src/ui/` folder (add `index.ts` only if useful). First consumer is the score sheet; later routes import the same component.

Optional later (out of scope for this feature): a hover-only `Tooltip` wrapper on `@radix-ui/react-tooltip` for non-interactive labels. Do not block score-sheet help on that.

Dependency: add `@radix-ui/react-popover` to `@roundhouse/web`.

### Score sheet interaction

- Label cell layout: `[Name] [ⓘ]` for every category row and for Upper total, Bonus, Total.
- Each ⓘ wraps `InfoTip` with category/footer help body.
- Score cells unchanged: still click-to-score when eligible.

### Content shape

Lives in the game package next to scoring (e.g. `packages/games/yatzy/src/help.ts`), exported from `@roundhouse/game-yatzy`:

```ts
type ScoreHelp = {
  title: string;
  what: string;
  score: string;
  example: string;
};

type ScoreHelpKey = Category | "upper_total" | "bonus" | "total";

function getScoreHelp(ruleset: Ruleset, key: ScoreHelpKey): ScoreHelp;
```

Plain data / pure functions only — no React, no Tailwind. Web renders title + What / Score / Example inside `InfoTip`. No current-roll values.

Ruleset-aware: Yatzy and Yahtzee diverge where `score.ts` diverges (pairs only in Yatzy; kinds/straights/full house scoring differ). Upper faces share one template (“sum of all N faces”).

Footer copy (static):

- **Upper total** — sum of ones–sixes only; example as short arithmetic toward the bonus threshold.
- **Bonus** — if upper ≥ 63 → 35, else 0.
- **Total** — sum of all filled category scores + bonus.

Examples for categories use a fixed dice line and resulting score consistent with `scoreCategory` for that ruleset (e.g. Ones: `1-1-1-2-3 → 3`).

Convention for later games: each `@roundhouse/game-*` package owns its help lookup beside its rules; web UI never hardcodes game-specific scoring prose.

### Components & files

| Piece | Path | Role |
|---|---|---|
| `InfoTip` | `apps/web/src/ui/InfoTip.tsx` | Shared Radix Popover tip: pointer-mode open, portal, collision |
| Help data | `packages/games/yatzy/src/help.ts` (+ export from `index.ts`) | `getScoreHelp` / types; ruleset + key → strings |
| Help tests | `packages/games/yatzy/src/help.test.ts` | Completeness vs category lists + footers |
| Sheet wiring | `apps/web/src/games/yatzy/ScoreSheet.tsx` | Place ⓘ/`InfoTip` on labels; call `getScoreHelp(state.ruleset, key)` |
| Dep | `apps/web/package.json` | `@radix-ui/react-popover` |

No changes to scoring formulas, reducer, or protocol — help is documentation of existing rules.

### Accessibility

- ⓘ is a real `button` with `aria-label` like `About Ones` / `About Bonus`.
- Rely on Radix Popover a11y (`aria-expanded`, focus management, Esc). Fine-pointer hover-open is an enhancement on top of the same Popover content — do not dual-implement as `role="tooltip"` and `role="dialog"` for v1; one Popover panel is enough.

### Completeness guard

In `@roundhouse/game-yatzy`: for each ruleset, every id in `yatzyCategories` / `yahtzeeCategories` plus `upper_total`, `bonus`, `total` has a help entry (assert via `getScoreHelp`). Prevents shipping a missing tip when categories change.

Smoke-test `InfoTip` open/close with Testing Library (click toggle; optional hover if reliable in jsdom).

## Out of scope

- Live “with your dice” calculations inside the tip.
- Adding `@radix-ui/react-tooltip` in this change (defer until a hover-only use case appears).
- Wiring tips into lobby / dice tray / other routes beyond the score sheet (primitive is ready; call sites later).
- Defining a cross-game help interface in `@roundhouse/game-core` (convention only for now; promote to core when a second game lands).
- Explaining hold / roll / turn flow (dice tray UX).
- Changing bonus threshold or scoring formulas.

## Verification

- Manual desktop: hover ⓘ on a category and on Bonus; tip shows what/score/example; leave closes; score cell still scores.
- Manual mobile / coarse: tap opens, tap outside or again closes; no accidental score from tip.
- Switch ruleset (Yatzy vs Yahtzee): pair tips only on Yatzy; straight/full house/kind text matches that ruleset’s scoring.
- Package help completeness unit test.
- `InfoTip` unit smoke test.
- Existing score-sheet click-to-score tests still pass.
