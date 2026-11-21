# Category Help Tips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ⓘ score-sheet help tips (static what/score/example) via a shared Radix `InfoTip`, with help data owned by `@roundhouse/game-yatzy`.

**Architecture:** `getScoreHelp(ruleset, key)` in the game package supplies plain strings. Web `InfoTip` wraps `@radix-ui/react-popover` (hover-open on fine pointer, click-toggle on coarse). `ScoreSheet` places ⓘ next to each category and footer label.

**Tech Stack:** TypeScript, Vitest, React 19, Testing Library, Tailwind 4, `@radix-ui/react-popover`, pnpm workspace.

## Global Constraints

- Package manager: **pnpm** only.
- Help data: **plain strings / pure functions in `@roundhouse/game-yatzy`** — no React/Tailwind in the package.
- UI chrome: **shared `apps/web/src/ui/InfoTip.tsx` on `@radix-ui/react-popover`**.
- Content: **static only** — no live dice preview in tips.
- Scope: **all categories for active ruleset + upper_total + bonus + total**.
- Do **not** change scoring formulas, reducer, or protocol.
- Do **not** add `@radix-ui/react-tooltip` in this plan.
- Do **not** wire tips into lobby/dice tray beyond the score sheet.

## File Structure

```
packages/games/yatzy/src/
├── help.ts           # NEW — ScoreHelp types + getScoreHelp
├── help.test.ts      # NEW — completeness + sample assertions
├── index.ts          # MODIFY — export help API
└── …

apps/web/src/
├── ui/
│   ├── InfoTip.tsx       # NEW
│   └── InfoTip.test.tsx  # NEW
└── games/yatzy/
    ├── ScoreSheet.tsx      # MODIFY — ⓘ + help body
    └── ScoreSheet.test.tsx # MODIFY — about buttons / tip content
```

---

### Task 1: `getScoreHelp` in `@roundhouse/game-yatzy`

**Files:**

- Create: `packages/games/yatzy/src/help.ts`
- Create: `packages/games/yatzy/src/help.test.ts`
- Modify: `packages/games/yatzy/src/index.ts`

**Interfaces:**

- Produces:
  - `export type ScoreHelp = { title: string; what: string; score: string; example: string }`
  - `export type ScoreHelpKey = Category | "upper_total" | "bonus" | "total"`
  - `export function getScoreHelp(ruleset: Ruleset, key: ScoreHelpKey): ScoreHelp`

- [ ] **Step 1: Write the failing completeness test**

```ts
import { describe, expect, it } from "vitest";
import { yatzyCategories, yahtzeeCategories } from "./categories";
import { getScoreHelp, type ScoreHelpKey } from "./help";

const footers: ScoreHelpKey[] = ["upper_total", "bonus", "total"];

describe("getScoreHelp", () => {
  it("covers every yatzy category plus footers", () => {
    for (const key of [...yatzyCategories, ...footers]) {
      const help = getScoreHelp("yatzy", key);
      expect(help.title.length).toBeGreaterThan(0);
      expect(help.what.length).toBeGreaterThan(0);
      expect(help.score.length).toBeGreaterThan(0);
      expect(help.example.length).toBeGreaterThan(0);
    }
  });

  it("covers every yahtzee category plus footers", () => {
    for (const key of [...yahtzeeCategories, ...footers]) {
      const help = getScoreHelp("yahtzee", key);
      expect(help.title.length).toBeGreaterThan(0);
      expect(help.what.length).toBeGreaterThan(0);
      expect(help.score.length).toBeGreaterThan(0);
      expect(help.example.length).toBeGreaterThan(0);
    }
  });

  it("documents yatzy ones example matching scoreCategory", () => {
    expect(getScoreHelp("yatzy", "ones").example).toMatch(/1-1-1-2-3/);
    expect(getScoreHelp("yatzy", "ones").example).toMatch(/→\s*3/);
  });

  it("uses fixed 25 for yahtzee full house and sum for yatzy", () => {
    expect(getScoreHelp("yahtzee", "full_house").score).toMatch(/25/);
    expect(getScoreHelp("yatzy", "full_house").score.toLowerCase()).toMatch(/sum/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roundhouse/game-yatzy test -- src/help.test.ts`
Expected: FAIL (module not found / `getScoreHelp` undefined)

- [ ] **Step 3: Implement `help.ts` and export**

Implement ruleset-aware strings matching `score.ts` (pairs Yatzy-only; kinds/straights/full house diverge; bonus ≥63 → 35). Export from `index.ts`.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @roundhouse/game-yatzy test -- src/help.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/games/yatzy/src/help.ts packages/games/yatzy/src/help.test.ts packages/games/yatzy/src/index.ts
git commit -m "feat(game-yatzy): add getScoreHelp for category tips"
```

---

### Task 2: Shared `InfoTip` + Radix dependency

**Files:**

- Modify: `apps/web/package.json` (add `@radix-ui/react-popover`)
- Create: `apps/web/src/ui/InfoTip.tsx`
- Create: `apps/web/src/ui/InfoTip.test.tsx`

**Interfaces:**

- Produces: `export function InfoTip(props: { label: string; children: React.ReactNode; className?: string }): JSX.Element`

- [ ] **Step 1: Install dependency**

Run: `pnpm --filter @roundhouse/web add @radix-ui/react-popover`

- [ ] **Step 2: Write failing click-toggle test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { InfoTip } from "./InfoTip";

describe("InfoTip", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false, // coarse: click toggle
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

  it("toggles content on trigger click", async () => {
    const user = userEvent.setup();
    render(<InfoTip label="About Ones">Sum of ones</InfoTip>);
    expect(screen.queryByText("Sum of ones")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "About Ones" }));
    expect(screen.getByText("Sum of ones")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "About Ones" }));
    expect(screen.queryByText("Sum of ones")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @roundhouse/web test -- src/ui/InfoTip.test.tsx`
Expected: FAIL

- [ ] **Step 4: Implement `InfoTip`**

Controlled Radix Popover; fine pointer via `matchMedia('(hover: hover) and (pointer: fine)')` opens on mouse enter/focus with ~150ms close grace; coarse uses click only. Style content with cream/ink tokens, `max-w-xs`, rounded, shadow, `z-50`, `collisionPadding={8}`.

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @roundhouse/web test -- src/ui/InfoTip.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/src/ui/InfoTip.tsx apps/web/src/ui/InfoTip.test.tsx
# (lockfile at repo root if applicable)
git commit -m "feat(web): add shared InfoTip popover primitive"
```

---

### Task 3: Wire `ScoreSheet`

**Files:**

- Modify: `apps/web/src/games/yatzy/ScoreSheet.tsx`
- Modify: `apps/web/src/games/yatzy/ScoreSheet.test.tsx`

**Interfaces:**

- Consumes: `getScoreHelp`, `InfoTip`

- [ ] **Step 1: Extend ScoreSheet tests**

Assert `About Ones`, `About Bonus`, `About Upper total`, `About Total` buttons exist; click About Ones shows help `what`/`example` from `getScoreHelp("yatzy","ones")`; clicking About Ones does not call `onScore`.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @roundhouse/web test -- src/games/yatzy/ScoreSheet.test.tsx`
Expected: FAIL on missing About buttons

- [ ] **Step 3: Wire labels with InfoTip**

For each category + footers, render `[label][InfoTip]` with body:

```tsx
<p className="font-semibold">{help.title}</p>
<p>{help.what}</p>
<p>{help.score}</p>
<p className="text-slate-500">{help.example}</p>
```

Stub coarse `matchMedia` in new tests like InfoTip.

- [ ] **Step 4: Run full related tests**

Run: `pnpm --filter @roundhouse/game-yatzy test && pnpm --filter @roundhouse/web test -- src/games/yatzy/ScoreSheet.test.tsx src/ui/InfoTip.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): show category help tips on score sheet"
```

---

## Spec coverage

| Spec requirement                     | Task  |
| ------------------------------------ | ----- |
| ⓘ beside categories + footers        | 3     |
| Hover fine / click coarse            | 2     |
| Static what/score/example            | 1 + 3 |
| Help in game-yatzy                   | 1     |
| Shared InfoTip + Radix Popover       | 2     |
| Completeness tests                   | 1     |
| InfoTip smoke test                   | 2     |
| No live preview / no scoring changes | all   |
