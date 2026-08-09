# InfoTip on ruleset picker and dice tray

Date: 2026-08-09  
Status: approved for planning  
Extends: `2026-08-09-category-help-tips-design.md` (shared `InfoTip` already shipped)

## Goal

Players pick Yatzy vs Yahtzee with no in-product contrast, and learn hold/roll/score only from color + a one-line status helper. Category ⓘ tips already cover scoring rows; create-time and turn-flow gaps remain.

Wire the existing shared `InfoTip` to:

1. Lobby **Ruleset** label — static short contrast of the two rulesets
2. Play **Dice tray** header — static turn flow (rolls, hold, lock category)

Reuse the same popover interaction and styling. No live dice math. No behavior changes to create, roll, hold, or score.

## Decisions

| Topic | Choice |
|---|---|
| Scope | Ruleset picker + dice tray only (waiting room / presence / chat out of scope) |
| Ruleset tip content | Short static contrast of **both** rulesets — not selection-dependent |
| Depth | Bullets only; per-category detail stays on score-sheet ⓘ |
| Turn tip | One tray-level ⓘ (not per die) |
| Copy location | Plain strings / pure helpers in `@roundhouse/game-yatzy` (extend `help.ts`); web only renders |
| UI chrome | Existing `apps/web/src/ui/InfoTip.tsx` — no new Radix deps, no Tooltip |
| Yahtzee “bonus Yahtzee” | Do **not** document — not implemented in `score.ts` |

## Design

### Help API

Extend `packages/games/yatzy/src/help.ts` (keep one module until it grows unwieldy):

```ts
type SurfaceHelp = {
  title: string;
  body: string[]; // short bullets
};

function getRulesetCompareHelp(): SurfaceHelp;
function getTurnHelp(): SurfaceHelp;
```

Export from `@roundhouse/game-yatzy`. Completeness/smoke tests: non-empty title; `body.length >= 3`; ruleset copy mentions pairs and the full-house / kinds scoring split; turn copy mentions rolls and hold.

### Ruleset tip content (authoritative bullets)

Match `score.ts` / category lists:

- Yatzy includes **One pair** and **Two pairs**; Yahtzee does not
- **Three / four of a kind:** Yatzy scores face × N; Yahtzee scores the sum of all five dice
- **Straights / full house:** Yatzy uses exact sequences (small 15, large 20) and full house = sum of dice; Yahtzee uses any four-run small straight (30), either five-run large straight (40), and full house = 25
- Closing line: category ⓘ on the score sheet has full per-row detail

Title example: `Yatzy vs Yahtzee`.

### Turn tip content (authoritative bullets)

- Up to **3 rolls** per turn; “rolls left” is remaining rolls this turn
- **Tap a die** to hold or release (teal = held); holds unlock after the first roll of the turn
- After rolling, lock any open category on the sheet (including **0**) to end the turn — you may score before using all rolls

Title example: `How a turn works`.

### Lobby wiring

Path: `apps/web/src/routes/lobby.tsx`

- Beside the “Ruleset” label, render `InfoTip` with `label="About rulesets"`
- Body: title + list/paragraphs from `getRulesetCompareHelp()`
- Layout: label row as flex (`Ruleset` + ⓘ); select unchanged

### Dice tray wiring

Path: `apps/web/src/games/yatzy/DiceTray.tsx`

- Beside the “Dice tray” heading (or on the same header cluster as “rolls left”), one `InfoTip` with `label="About the dice tray"`
- Body from `getTurnHelp()`
- Die buttons and Roll remain the only action targets for hold/roll; tip must not fire those handlers

### Components & files

| Piece | Path | Role |
|---|---|---|
| Surface help | `packages/games/yatzy/src/help.ts` (+ tests, `index.ts` export) | `getRulesetCompareHelp` / `getTurnHelp` |
| Lobby | `apps/web/src/routes/lobby.tsx` (+ test if present / add focused test) | Ruleset ⓘ |
| Dice tray | `apps/web/src/games/yatzy/DiceTray.tsx` (+ `DiceTray.test.tsx`) | Turn ⓘ |
| `InfoTip` | unchanged | Shared primitive |

### Accessibility

- Triggers are real buttons via `InfoTip` (`aria-label` from `label` prop)
- Do not put the tip trigger inside the `<select>` or die buttons
- Existing Popover a11y (Esc / outside / focus) unchanged

### Out of scope

- Waiting-room Start / seats / “Ready” copy
- Presence dots, recent-table status jargon
- Chat held-die chips
- Selection-aware ruleset tip body
- Expanding always-visible status helper instead of (or in addition to) the tray tip as the primary explain affordance
- `@radix-ui/react-tooltip`
- Scoring / reducer / protocol changes

## Verification

- Manual lobby: hover/tap ⓘ by Ruleset; contrast bullets; create table still works with either ruleset
- Manual play: hover/tap ⓘ on dice tray; hold/roll/score still work; tip open does not toggle dice or roll
- Package unit tests for both helpers
- Lobby + DiceTray tests: About buttons present; tip content smoke; tray tip click does not call `onRoll` / `onToggleHold`
- Existing score-sheet and `InfoTip` tests still pass
