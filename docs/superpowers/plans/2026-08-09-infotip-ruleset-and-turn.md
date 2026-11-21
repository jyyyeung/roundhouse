# InfoTip Ruleset and Turn Help Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lobby ruleset-contrast and dice-tray turn-flow ⓘ tips via existing `InfoTip`, with copy owned by `@roundhouse/game-yatzy`.

**Architecture:** `getRulesetCompareHelp()` / `getTurnHelp()` return `{ title, body: string[] }` from `help.ts`. Lobby and `DiceTray` render those bullets inside shared `InfoTip`. No new Radix deps; no scoring/reducer changes.

**Tech Stack:** TypeScript, Vitest, React 19, Testing Library, Tailwind 4, existing `@radix-ui/react-popover` `InfoTip`, pnpm workspace.

## Global Constraints

- Package manager: **pnpm** only.
- Help data: **plain strings / pure functions in `@roundhouse/game-yatzy`** — no React/Tailwind in the package.
- UI chrome: **reuse `apps/web/src/ui/InfoTip.tsx`** — do not add `@radix-ui/react-tooltip`.
- Content: **static only** — no live dice preview; ruleset tip is **not** selection-dependent.
- Scope: **ruleset picker + dice tray only** — not waiting room, presence, chat, or score sheet (already tipped).
- Do **not** document bonus Yahtzee (not in `score.ts`).
- Do **not** change scoring formulas, reducer, protocol, roll/hold behavior.

## File Structure

```
packages/games/yatzy/src/
├── help.ts           # MODIFY — SurfaceHelp + getRulesetCompareHelp + getTurnHelp
├── help.test.ts      # MODIFY — surface help assertions
├── index.ts          # MODIFY — export new API
└── …

apps/web/src/
├── ui/InfoTip.tsx                    # unchanged
├── routes/lobby.tsx                  # MODIFY — Ruleset ⓘ
├── routes/lobby.test.tsx             # MODIFY — About rulesets
└── games/yatzy/
    ├── DiceTray.tsx                  # MODIFY — turn ⓘ
    └── DiceTray.test.tsx             # MODIFY — About dice tray
```

---

### Task 1: Surface help in `@roundhouse/game-yatzy`

**Files:**

- Modify: `packages/games/yatzy/src/help.ts`
- Modify: `packages/games/yatzy/src/help.test.ts`
- Modify: `packages/games/yatzy/src/index.ts`

**Interfaces:**

- Produces:
  - `export type SurfaceHelp = { title: string; body: string[] }`
  - `export function getRulesetCompareHelp(): SurfaceHelp`
  - `export function getTurnHelp(): SurfaceHelp`

- [ ] **Step 1: Write the failing surface-help tests**

Append to `help.test.ts` (keep existing `getScoreHelp` tests):

```ts
import { getRulesetCompareHelp, getTurnHelp } from "./help";

describe("getRulesetCompareHelp", () => {
  it("returns a short contrast with pairs and scoring splits", () => {
    const help = getRulesetCompareHelp();
    expect(help.title.length).toBeGreaterThan(0);
    expect(help.body.length).toBeGreaterThanOrEqual(3);
    const joined = help.body.join(" ").toLowerCase();
    expect(joined).toMatch(/pair/);
    expect(joined).toMatch(/25/);
    expect(joined).toMatch(/sum/);
  });
});

describe("getTurnHelp", () => {
  it("covers rolls and hold", () => {
    const help = getTurnHelp();
    expect(help.title.length).toBeGreaterThan(0);
    expect(help.body.length).toBeGreaterThanOrEqual(3);
    const joined = help.body.join(" ").toLowerCase();
    expect(joined).toMatch(/roll/);
    expect(joined).toMatch(/hold/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roundhouse/game-yatzy test -- src/help.test.ts`
Expected: FAIL (`getRulesetCompareHelp` / `getTurnHelp` not exported)

- [ ] **Step 3: Implement helpers and export**

In `help.ts`, add (copy must match spec / `score.ts`):

```ts
export type SurfaceHelp = {
  title: string;
  body: string[];
};

export function getRulesetCompareHelp(): SurfaceHelp {
  return {
    title: "Yatzy vs Yahtzee",
    body: [
      "Yatzy includes One pair and Two pairs; Yahtzee does not.",
      "Three / four of a kind: Yatzy scores face × N; Yahtzee scores the sum of all five dice.",
      "Straights / full house: Yatzy uses exact sequences (small 15, large 20) and full house = sum of dice; Yahtzee uses any four-run small straight (30), either five-run large straight (40), and full house = 25.",
      "Open a category ⓘ on the score sheet for full per-row detail.",
    ],
  };
}

export function getTurnHelp(): SurfaceHelp {
  return {
    title: "How a turn works",
    body: [
      "Up to 3 rolls per turn; “rolls left” is remaining rolls this turn.",
      "Tap a die to hold or release (teal = held); holds unlock after the first roll of the turn.",
      "After rolling, lock any open category on the sheet (including 0) to end the turn — you may score before using all rolls.",
    ],
  };
}
```

Export from `index.ts`:

```ts
export { getScoreHelp, getRulesetCompareHelp, getTurnHelp } from "./help";
export type { ScoreHelp, ScoreHelpKey, SurfaceHelp } from "./help";
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @roundhouse/game-yatzy test -- src/help.test.ts`
Expected: PASS (existing + new)

- [ ] **Step 5: Commit**

```bash
git add packages/games/yatzy/src/help.ts packages/games/yatzy/src/help.test.ts packages/games/yatzy/src/index.ts
git commit -m "feat(game-yatzy): add ruleset and turn surface help"
```

---

### Task 2: Wire `DiceTray`

**Files:**

- Modify: `apps/web/src/games/yatzy/DiceTray.tsx`
- Modify: `apps/web/src/games/yatzy/DiceTray.test.tsx`

**Interfaces:**

- Consumes: `getTurnHelp`, `InfoTip`
- Produces: ⓘ with `label="About the dice tray"` beside the Dice tray header

- [ ] **Step 1: Extend DiceTray tests**

Add imports and coarse `matchMedia` stub (same pattern as `ScoreSheet.test.tsx` / `InfoTip.test.tsx`). Append:

```tsx
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach } from "vitest";
import { getTurnHelp } from "@roundhouse/game-yatzy";

// inside describe, before existing tests:
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("shows turn help without rolling or holding", async () => {
  const user = userEvent.setup();
  const onRoll = vi.fn();
  const onToggleHold = vi.fn();
  const help = getTurnHelp();

  render(<DiceTray {...baseProps} onRoll={onRoll} onToggleHold={onToggleHold} />);

  expect(screen.getByRole("button", { name: "About the dice tray" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "About the dice tray" }));
  expect(screen.getByText(help.title)).toBeInTheDocument();
  expect(screen.getByText(help.body[0]!)).toBeInTheDocument();
  expect(onRoll).not.toHaveBeenCalled();
  expect(onToggleHold).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @roundhouse/web test -- src/games/yatzy/DiceTray.test.tsx`
Expected: FAIL on missing About button

- [ ] **Step 3: Wire InfoTip on the tray header**

```tsx
import { getTurnHelp } from "@roundhouse/game-yatzy";
import { InfoTip } from "../../ui/InfoTip";

// in DiceTray render, replace the left header block:
const turnHelp = getTurnHelp();
// …
<div>
  <div className="flex items-center gap-1.5">
    <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--color-coral)]">
      Dice tray
    </p>
    <InfoTip label="About the dice tray">
      <div className="space-y-1">
        <p className="font-semibold">{turnHelp.title}</p>
        {turnHelp.body.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </InfoTip>
  </div>
  <p className="mt-2 text-sm text-slate-600">{props.rollsLeft} rolls left</p>
</div>;
```

Keep Roll button and die buttons unchanged.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @roundhouse/web test -- src/games/yatzy/DiceTray.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/games/yatzy/DiceTray.tsx apps/web/src/games/yatzy/DiceTray.test.tsx
git commit -m "feat(web): add dice tray turn help tip"
```

---

### Task 3: Wire lobby Ruleset tip

**Files:**

- Modify: `apps/web/src/routes/lobby.tsx`
- Modify: `apps/web/src/routes/lobby.test.tsx`

**Interfaces:**

- Consumes: `getRulesetCompareHelp`, `InfoTip`
- Produces: ⓘ with `label="About rulesets"` beside the Ruleset label

- [ ] **Step 1: Extend lobby tests**

Add coarse `matchMedia` stub in `beforeEach` (alongside existing clears), import `userEvent` if needed, `getRulesetCompareHelp`, and:

```tsx
import { getRulesetCompareHelp } from "@roundhouse/game-yatzy";

it("shows ruleset contrast help beside the picker", async () => {
  const user = userEvent.setup();
  const help = getRulesetCompareHelp();

  renderLobby();
  await waitFor(() => {
    expect(getRecentTables).toHaveBeenCalled();
  });

  expect(screen.getByRole("button", { name: "About rulesets" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "About rulesets" }));
  expect(screen.getByText(help.title)).toBeInTheDocument();
  expect(screen.getByText(help.body[0]!)).toBeInTheDocument();
});
```

Stub `matchMedia` like DiceTray (coarse / click toggle).

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @roundhouse/web test -- src/routes/lobby.test.tsx`
Expected: FAIL on missing About rulesets

- [ ] **Step 3: Wire InfoTip on Ruleset label**

```tsx
import { getRulesetCompareHelp } from "@roundhouse/game-yatzy";
import { InfoTip } from "../ui/InfoTip";

const rulesetHelp = getRulesetCompareHelp();
// …
<label className="mt-4 block">
  <span className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
    Ruleset
    <InfoTip label="About rulesets">
      <div className="space-y-1">
        <p className="font-semibold">{rulesetHelp.title}</p>
        {rulesetHelp.body.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </InfoTip>
  </span>
  <select /* unchanged */>…</select>
</label>;
```

`getRulesetCompareHelp()` may be called at module scope or inside the component — either is fine (static data). Prefer inside render or a module const; do not depend on selected `ruleset` state.

- [ ] **Step 4: Run related tests**

Run: `pnpm --filter @roundhouse/game-yatzy test && pnpm --filter @roundhouse/web test -- src/routes/lobby.test.tsx src/games/yatzy/DiceTray.test.tsx src/games/yatzy/ScoreSheet.test.tsx src/ui/InfoTip.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/lobby.tsx apps/web/src/routes/lobby.test.tsx
git commit -m "feat(web): add lobby ruleset contrast tip"
```

---

## Spec coverage

| Spec requirement                            | Task  |
| ------------------------------------------- | ----- |
| Ruleset ⓘ short static contrast             | 1 + 3 |
| Dice tray ⓘ turn/hold/score                 | 1 + 2 |
| Copy in `@roundhouse/game-yatzy`            | 1     |
| Reuse `InfoTip`                             | 2 + 3 |
| No selection-dependent ruleset tip          | 3     |
| No bonus Yahtzee / no scoring changes       | all   |
| Package + lobby + tray tests                | 1–3   |
| Waiting room / presence / chat out of scope | —     |
