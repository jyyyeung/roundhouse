# Yatzy UI Polish (Dice Faces & Score Previews) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace roman die faces with soft pip dice and simplify score-sheet cells to show preview scores or `—` instead of “Open / Would score …”.

**Architecture:** Extract a reusable `DieFace` component (`variant: "soft" | "classic"`, default soft) used by `DiceTray`. Keep hold/roll chrome on the tray button. Rewrite `ScoreSheet` cell label to a single primary value derived from scored / preview / dash. No game-logic or server changes.

**Tech Stack:** React 19, Tailwind CSS 4, Motion (existing tray animations), Vitest + Testing Library, pnpm workspace `@roundhouse/web`.

## Global Constraints

- Package manager: **pnpm** only.
- Die variants: **`"soft" | "classic"` only** — no unicode.
- Default variant: **`"soft"`**.
- Unscored no-preview cells: em dash **`—`** (U+2014), not hyphen-minus.
- No style picker / persistence in this plan.
- Chat snapshot dice display: out of scope.
- Do not change scoring rules, intents, or server code.

---

## File Structure

```
apps/web/src/games/yatzy/
├── DieFace.tsx              # NEW — pip face renderer
├── DieFace.test.tsx         # NEW
├── DiceTray.tsx             # MODIFY — use DieFace, drop roman map
├── DiceTray.test.tsx        # NEW
├── ScoreSheet.tsx           # MODIFY — single-value cells
├── ScoreSheet.test.tsx      # NEW
├── YatzyTable.tsx           # unchanged
├── ChatPanel.tsx            # unchanged (out of scope)
└── model.ts                 # unchanged (previewScore already exists)
```

---

### Task 1: `DieFace` component

**Files:**

- Create: `apps/web/src/games/yatzy/DieFace.tsx`
- Test: `apps/web/src/games/yatzy/DieFace.test.tsx`

**Interfaces:**

- Consumes: none
- Produces: `export type DieFaceVariant = "soft" | "classic"`; `export function DieFace(props: { value: number; variant?: DieFaceVariant; className?: string }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/games/yatzy/DieFace.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DieFace } from "./DieFace";

describe("DieFace", () => {
  it("renders five pips for value 5 with soft variant by default", () => {
    render(<DieFace value={5} />);

    const face = screen.getByTestId("die-face");
    expect(face).toHaveAttribute("data-value", "5");
    expect(face).toHaveAttribute("data-variant", "soft");
    expect(face.querySelectorAll("[data-pip]")).toHaveLength(5);
  });

  it("renders no pips for value 0", () => {
    render(<DieFace value={0} />);

    const face = screen.getByTestId("die-face");
    expect(face).toHaveAttribute("data-value", "0");
    expect(face.querySelectorAll("[data-pip]")).toHaveLength(0);
  });

  it("supports classic variant without soft chrome class", () => {
    render(<DieFace value={3} variant="classic" />);

    const face = screen.getByTestId("die-face");
    expect(face).toHaveAttribute("data-variant", "classic");
    expect(face.className).not.toMatch(/die-face--soft/);
    expect(face.querySelectorAll("[data-pip]")).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/DieFace.test.tsx`

Expected: FAIL (module `./DieFace` not found, or `DieFace` undefined)

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/games/yatzy/DieFace.tsx`:

```tsx
export type DieFaceVariant = "soft" | "classic";

type DieFaceProps = {
  value: number;
  variant?: DieFaceVariant;
  className?: string;
};

/** Standard die pip positions in a 3×3 grid (row-major indices 0–8). */
const PIP_LAYOUT: Record<number, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function DieFace(props: DieFaceProps) {
  const variant = props.variant ?? "soft";
  const clamped = Number.isFinite(props.value)
    ? Math.max(0, Math.min(6, Math.trunc(props.value)))
    : 0;
  const pips = PIP_LAYOUT[clamped] ?? [];

  return (
    <span
      data-testid="die-face"
      data-value={clamped}
      data-variant={variant}
      aria-hidden="true"
      className={[
        "die-face grid h-full w-full grid-cols-3 grid-rows-3 place-items-center gap-0.5 p-[18%]",
        variant === "soft"
          ? "die-face--soft rounded-[1.1rem] bg-[linear-gradient(145deg,#ffffff_0%,#f1f5f9_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_6px_rgba(26,26,26,0.08)]"
          : "rounded-[1.1rem]",
        props.className ?? "",
      ].join(" ")}
    >
      {Array.from({ length: 9 }, (_, index) => {
        const active = pips.includes(index);
        return (
          <span
            key={index}
            data-pip={active ? "" : undefined}
            className={
              active
                ? "block size-[22%] min-h-1.5 min-w-1.5 rounded-full bg-[var(--color-ink)] shadow-[0_1px_1px_rgba(0,0,0,0.15)]"
                : "block size-[22%] min-h-1.5 min-w-1.5"
            }
          />
        );
      })}
    </span>
  );
}
```

Notes for implementer:

- Soft face draws its own light gradient so pips read on both white and teal held buttons. Held teal still comes from the outer tray button background around/behind this face — if contrast looks wrong in manual check, prefer making the soft face slightly translucent (`bg-white/70`) rather than inventing new colors.
- Keep `aria-hidden` — parent tray button owns accessible name.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/DieFace.test.tsx`

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/games/yatzy/DieFace.tsx apps/web/src/games/yatzy/DieFace.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add DieFace soft/classic pip renderer

EOF
)"
```

---

### Task 2: Wire `DieFace` into `DiceTray`

**Files:**

- Modify: `apps/web/src/games/yatzy/DiceTray.tsx`
- Test: `apps/web/src/games/yatzy/DiceTray.test.tsx`

**Interfaces:**

- Consumes: `DieFace` from `./DieFace` (`value`, default soft variant)
- Produces: unchanged `DiceTray` props API

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/games/yatzy/DiceTray.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiceTray } from "./DiceTray";

const baseProps = {
  dice: [1, 2, 3, 4, 5],
  holds: [false, true, false, false, false],
  rollsLeft: 2,
  canRoll: true,
  canToggleHolds: true,
  rollVersion: 1,
  onToggleHold: vi.fn(),
  onRoll: vi.fn(),
};

describe("DiceTray", () => {
  it("renders DieFace for each die instead of roman numerals", () => {
    render(<DiceTray {...baseProps} />);

    const faces = screen.getAllByTestId("die-face");
    expect(faces).toHaveLength(5);
    expect(faces.map((face) => face.getAttribute("data-value"))).toEqual(["1", "2", "3", "4", "5"]);
    expect(screen.queryByText("II")).not.toBeInTheDocument();
    expect(screen.queryByText("V")).not.toBeInTheDocument();
  });

  it("keeps hold controls on the outer buttons", () => {
    render(<DiceTray {...baseProps} />);

    expect(screen.getByRole("button", { name: /hold die 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /release die 2/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/DiceTray.test.tsx`

Expected: FAIL — roman numerals still present and/or no `die-face` nodes

- [ ] **Step 3: Update `DiceTray`**

In `apps/web/src/games/yatzy/DiceTray.tsx`:

1. Add `import { DieFace } from "./DieFace";`
2. Delete `const DIE_FACES = ["-", "I", "II", "III", "IV", "V", "VI"];`
3. Replace the button children `{DIE_FACES[value] ?? value}` with:

```tsx
<DieFace value={value} />;
```

4. Adjust the die button classes so text sizing for roman glyphs is gone and the face fills the tile. Replace the button `className` array with something equivalent to:

```tsx
className={[
  "aspect-square overflow-hidden rounded-[1.4rem] border p-1.5 shadow-sm transition",
  held
    ? "border-[var(--color-teal-deep)] bg-[var(--color-teal)] text-[var(--color-ink)]"
    : "border-slate-200 bg-white text-[var(--color-ink)]",
].join(" ")}
```

Keep `layout`, `animate`, `whileTap`, `onClick`, `disabled`, `aria-pressed`, and `aria-label` unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/DiceTray.test.tsx src/games/yatzy/DieFace.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/games/yatzy/DiceTray.tsx apps/web/src/games/yatzy/DiceTray.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): render soft pip dice in the tray

EOF
)"
```

---

### Task 3: Simplify `ScoreSheet` cell labels

**Files:**

- Modify: `apps/web/src/games/yatzy/ScoreSheet.tsx`
- Test: `apps/web/src/games/yatzy/ScoreSheet.test.tsx`

**Interfaces:**

- Consumes: existing `previewScore`, `formatCategory`, `categoriesFor` from `./model`
- Produces: unchanged `ScoreSheet` props API; cell display rules below

Display rules (exact):

- `value !== null` → show `value`
- else if `isClickable && preview !== null` → show `preview`
- else → show `—`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/games/yatzy/ScoreSheet.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { YatzyState } from "@roundhouse/game-yatzy";

import { ScoreSheet } from "./ScoreSheet";

function baseState(overrides: Partial<YatzyState> = {}): YatzyState {
  return {
    ruleset: "yatzy",
    playerIds: ["user-a", "user-b"],
    currentPlayerIndex: 0,
    rollsLeft: 2,
    dice: [1, 1, 1, 2, 3],
    holds: [false, false, false, false, false],
    sheets: {
      "user-a": {
        ones: null,
        twos: null,
        threes: null,
        fours: null,
        fives: null,
        sixes: null,
        one_pair: null,
        two_pairs: null,
        three_kind: null,
        four_kind: null,
        small_straight: null,
        large_straight: null,
        full_house: null,
        chance: null,
        yatzy: null,
        bonus: null,
      },
      "user-b": {
        ones: 3,
        twos: null,
        threes: null,
        fours: null,
        fives: null,
        sixes: null,
        one_pair: null,
        two_pairs: null,
        three_kind: null,
        four_kind: null,
        small_straight: null,
        large_straight: null,
        full_house: null,
        chance: null,
        yatzy: null,
        bonus: null,
      },
    },
    phase: "playing",
    winnerIds: [],
    ...overrides,
  };
}

describe("ScoreSheet", () => {
  it("shows preview score for clickable open cells and dash otherwise", () => {
    render(
      <ScoreSheet
        state={baseState()}
        playerLabels={{ "user-a": "You", "user-b": "Player 2" }}
        currentUserId="user-a"
        canScore
        onScore={vi.fn()}
      />,
    );

    // Ones with dice [1,1,1,2,3] preview = 3 for current player
    expect(screen.getByRole("button", { name: /score ones/i })).toHaveTextContent("3");
    expect(screen.queryByText("Open")).not.toBeInTheDocument();
    expect(screen.queryByText(/would score/i)).not.toBeInTheDocument();

    // Opponent scored ones = 3; other opponent open cells are dashes
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("shows dash when dice are unrolled even if clickable", () => {
    render(
      <ScoreSheet
        state={baseState({ dice: [0, 0, 0, 0, 0] })}
        playerLabels={{ "user-a": "You", "user-b": "Player 2" }}
        currentUserId="user-a"
        canScore
        onScore={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /score ones/i })).toHaveTextContent("—");
  });

  it("invokes onScore when a preview cell is clicked", async () => {
    const user = userEvent.setup();
    const onScore = vi.fn();

    render(
      <ScoreSheet
        state={baseState()}
        playerLabels={{ "user-a": "You", "user-b": "Player 2" }}
        currentUserId="user-a"
        canScore
        onScore={onScore}
      />,
    );

    await user.click(screen.getByRole("button", { name: /score ones/i }));
    expect(onScore).toHaveBeenCalledWith("ones");
  });
});
```

If the sheet shape needs `as YatzyState` because of index signatures, cast the fixture once at return — do not invent alternate category key names.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/ScoreSheet.test.tsx`

Expected: FAIL — still shows `Open` / `Would score`

- [ ] **Step 3: Update `ScoreSheet` cell rendering**

In `apps/web/src/games/yatzy/ScoreSheet.tsx`, replace the button children and aria-label logic inside the map:

```tsx
const display =
  value !== null ? value : isClickable && preview !== null ? preview : "—";

// ...
aria-label={
  value !== null
    ? `${formatCategory(category)} ${value}`
    : preview !== null && isClickable
      ? `Score ${formatCategory(category)} — ${preview}`
      : `Score ${formatCategory(category)}`
}
// ...
<span className="block font-semibold">{display}</span>
```

Delete the subtitle span that rendered `Would score {preview}`.

Do not change totals/bonus rows or background class logic.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/ScoreSheet.test.tsx src/games/yatzy/DiceTray.test.tsx src/games/yatzy/DieFace.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/games/yatzy/ScoreSheet.tsx apps/web/src/games/yatzy/ScoreSheet.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): show score previews as primary sheet values

EOF
)"
```

---

### Task 4: Full web verification

**Files:**

- None new (regression only)

**Interfaces:**

- Consumes: Tasks 1–3 deliverables
- Produces: green `@roundhouse/web` test + typecheck suite

- [ ] **Step 1: Run full web unit tests**

Run: `pnpm --filter @roundhouse/web test`

Expected: PASS (all existing + new tests)

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @roundhouse/web typecheck`

Expected: exit 0

- [ ] **Step 3: Manual smoke (if local app is running)**

On the table route after a roll:

- Dice show soft pips, not I–VI
- Held die keeps teal chrome
- Clickable open categories show a number only
- Unscored non-preview cells show `—`
- No “Open” / “Would score” copy

If the app is not running, skip and note in the final summary.

- [ ] **Step 4: Commit only if Step 3 required follow-up fixes**

Otherwise no commit — Tasks 1–3 already committed.

---

## Spec coverage checklist

| Spec requirement                            | Task               |
| ------------------------------------------- | ------------------ |
| Soft pip `DieFace` default                  | Task 1             |
| `classic` variant branch (no unicode)       | Task 1             |
| Empty face for `value === 0`                | Task 1             |
| `DiceTray` uses `DieFace`, remove roman map | Task 2             |
| Hold styling stays on outer button          | Task 2             |
| Scored → number; preview → number; else `—` | Task 3             |
| No “Open” / “Would score” subtitle          | Task 3             |
| aria-label includes preview when relevant   | Task 3             |
| Tests updated/added                         | Tasks 1–3          |
| Chat snapshot / style picker out of scope   | Explicitly omitted |

## Self-review notes

- No TBD/placeholder steps.
- `DieFace` / `DiceTray` / `ScoreSheet` prop names consistent across tasks.
- Em dash character is `—` everywhere in tests and implementation.
- Category fixture keys match `yatzyCategories` (`three_kind` / `four_kind`, not alike/of-a-kind aliases).
