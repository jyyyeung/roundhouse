# Yatzy Responsive Layout (Balanced Playboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the in-game Yatzy table side-by-side on laptop/tablet with capped dice, and reclaim vertical space on mobile via a collapsible status strip and denser score rows.

**Architecture:** Keep game logic untouched. Restructure `YatzyTable` into a `md+` two-column CSS grid (left: status + dice + standings; right: score sheet). Cap die button sizes in `DiceTray`. Densify `ScoreSheet` cells and enable in-panel overflow on desktop. Mobile status uses local React expand/collapse state (always starts collapsed).

**Tech Stack:** React 19, Tailwind CSS 4, Motion (existing), Vitest + Testing Library, pnpm workspace `@roundhouse/web`.

## Global Constraints

- Package manager: **pnpm** only.
- Breakpoint: Tailwind **`md` (768px)**.
- Desktop columns: ~**42% / 58%** (play / sheet).
- Die size caps: ~**56–64px** desktop, ~**48px** mobile.
- Mobile banner: **collapsed by default**; expand on tap; **no persistence**.
- Standings: **desktop only** (hidden below `md`); slim strip under dice.
- Do **not** change scoring rules, intents, server, chat panel, lobby, or `DieFace`.
- Cell semantics stay: locked value / preview / em dash **`—`**.

---

## File Structure

```
apps/web/src/games/yatzy/
├── DiceTray.tsx           # MODIFY — cap die size, center row
├── DiceTray.test.tsx      # MODIFY — assert size classes
├── ScoreSheet.tsx         # MODIFY — dense padding + desktop scroll shell
├── ScoreSheet.test.tsx    # MODIFY — assert dense / scroll classes
├── YatzyTable.tsx         # MODIFY — grid, banner expand, standings placement
├── YatzyTable.test.tsx    # NEW — banner expand + layout / standings classes
├── DieFace.tsx            # unchanged
└── ChatPanel.tsx          # unchanged
```

---

### Task 1: Cap dice size in `DiceTray`

**Files:**

- Modify: `apps/web/src/games/yatzy/DiceTray.tsx`
- Modify: `apps/web/src/games/yatzy/DiceTray.test.tsx`

**Interfaces:**

- Consumes: existing `DiceTrayProps` unchanged
- Produces: same `DiceTray` API; die buttons use fixed max size classes instead of full-width `aspect-square` growth

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/games/yatzy/DiceTray.test.tsx`:

```tsx
it("caps die buttons so they do not stretch full column width", () => {
  render(<DiceTray {...baseProps} />);

  const die = screen.getByRole("button", { name: /hold die 1/i });
  expect(die.className).toMatch(/size-12/);
  expect(die.className).toMatch(/md:size-14/);
  expect(die.className).not.toMatch(/aspect-square/);
});

it("centers the dice row", () => {
  const { container } = render(<DiceTray {...baseProps} />);
  const row = container.querySelector(".dice-row");
  expect(row?.className).toMatch(/justify-center/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/DiceTray.test.tsx`

Expected: FAIL — missing `size-12` / `dice-row` / still has `aspect-square`

- [ ] **Step 3: Write minimal implementation**

In `DiceTray.tsx`, replace the dice grid with a capped, centered row:

```tsx
<div className="dice-row mt-4 flex flex-wrap justify-center gap-3">
  {props.dice.map((value, index) => {
    const held = props.holds[index];

    return (
      <motion.button
        key={index}
        type="button"
        layout
        className={[
          "size-12 overflow-hidden rounded-[1.4rem] border p-1.5 shadow-sm transition md:size-14",
          held
            ? "border-[var(--color-teal-deep)] bg-[var(--color-teal)] text-[var(--color-ink)]"
            : "border-slate-200 bg-white text-[var(--color-ink)]",
        ].join(" ")}
        animate={{
          rotate: props.rollVersion > 0 ? [0, -8, 8, -5, 0] : 0,
          y: props.rollVersion > 0 ? [0, -6, 0] : 0,
          scale: held ? 1.04 : 1,
        }}
        transition={{ duration: 0.35, delay: index * 0.03 }}
        whileTap={props.canToggleHolds ? { scale: 0.94 } : undefined}
        onClick={() => props.onToggleHold(index)}
        disabled={!props.canToggleHolds}
        aria-pressed={held}
        aria-label={held ? `Release die ${index + 1}` : `Hold die ${index + 1}`}
      >
        <DieFace value={value} />
      </motion.button>
    );
  })}
</div>;
```

Keep the section header / Roll button markup unchanged. Optional: slightly reduce section padding (`p-4` instead of `p-5`) — only if it does not break existing tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/DiceTray.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/games/yatzy/DiceTray.tsx apps/web/src/games/yatzy/DiceTray.test.tsx
git commit -m "$(cat <<'EOF'
fix(web): cap Yatzy dice size on wide layouts

EOF
)"
```

---

### Task 2: Densify `ScoreSheet` and enable desktop in-panel scroll

**Files:**

- Modify: `apps/web/src/games/yatzy/ScoreSheet.tsx`
- Modify: `apps/web/src/games/yatzy/ScoreSheet.test.tsx`

**Interfaces:**

- Consumes: existing `ScoreSheetProps` unchanged
- Produces: same API; root section exposes scroll/dense classes for desktop grid fill

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/games/yatzy/ScoreSheet.test.tsx`:

```tsx
it("uses dense cell padding and desktop scroll shell", () => {
  const { container } = render(
    <ScoreSheet
      state={baseState()}
      playerLabels={{ "user-a": "You", "user-b": "Player 2" }}
      currentUserId="user-a"
      canScore
      onScore={vi.fn()}
    />,
  );

  const section = container.querySelector("section");
  expect(section?.className).toMatch(/md:min-h-0/);
  expect(section?.className).toMatch(/md:overflow-y-auto/);
  expect(section?.className).toMatch(/md:h-full/);

  const onesButton = screen.getByRole("button", { name: /score ones/i });
  expect(onesButton.className).toMatch(/py-2/);
  expect(onesButton.className).not.toMatch(/py-3/);
});
```

Keep existing preview / dash tests intact.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/ScoreSheet.test.tsx`

Expected: FAIL — missing `md:min-h-0` / still `py-3` on cells

- [ ] **Step 3: Write minimal implementation**

Update `ScoreSheet.tsx` root and cell padding:

```tsx
    <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/88 shadow-[0_20px_60px_rgba(26,26,26,0.1)] backdrop-blur md:h-full md:min-h-0 md:overflow-y-auto">
```

Header cells:

```tsx
              <th className="px-3 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-[var(--color-coral)]">Category</th>
              {props.state.playerIds.map((playerId) => (
                <th key={playerId} className="px-3 py-2 text-sm font-semibold text-[var(--color-ink)]">
```

Category label cells: `px-3 py-1.5` instead of `px-4 py-3`.

Score buttons:

```tsx
                          "w-full rounded-2xl px-3 py-2 text-left text-sm transition",
```

Footer rows (`Upper total` / `Bonus` / `Total`): `px-3 py-2` instead of `px-4 py-3`.

Do not change display logic (`value` / `preview` / `—`) or `aria-label` rules.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/ScoreSheet.test.tsx`

Expected: PASS (including existing preview tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/games/yatzy/ScoreSheet.tsx apps/web/src/games/yatzy/ScoreSheet.test.tsx
git commit -m "$(cat <<'EOF'
fix(web): densify score sheet and scroll on desktop

EOF
)"
```

---

### Task 3: Responsive `YatzyTable` — grid, collapsible banner, standings

**Files:**

- Modify: `apps/web/src/games/yatzy/YatzyTable.tsx`
- Create: `apps/web/src/games/yatzy/YatzyTable.test.tsx`

**Interfaces:**

- Consumes: existing `YatzyTableProps`; `DiceTray`; `ScoreSheet`; `ChatPanel`; `totalScore`
- Produces: same public props; internal `statusExpanded` state (boolean, default `false`)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/games/yatzy/YatzyTable.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TableMeta } from "@roundhouse/game-core";
import type { YatzyState } from "@roundhouse/game-yatzy";

import { YatzyTable } from "./YatzyTable";

function baseMeta(overrides: Partial<TableMeta> = {}): TableMeta {
  return {
    code: "Z2YLBJ",
    gameId: "yatzy",
    config: { ruleset: "yatzy" },
    status: "active",
    hostUserId: "user-a",
    seatUserIds: ["user-a", "user-b"],
    softSeatCap: 4,
    ...overrides,
  };
}

function baseState(overrides: Partial<YatzyState> = {}): YatzyState {
  return {
    ruleset: "yatzy",
    playerIds: ["user-a", "user-b"],
    currentPlayerIndex: 0,
    rollsLeft: 2,
    dice: [1, 2, 3, 4, 5],
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
    },
    phase: "playing",
    winnerIds: [],
    ...overrides,
  };
}

describe("YatzyTable", () => {
  const defaultProps = {
    meta: baseMeta(),
    state: baseState(),
    currentUserId: "user-a",
    onlineUserIds: ["user-a", "user-b"],
    messages: [],
    onIntent: vi.fn(),
    onSendChat: vi.fn(),
    rollVersion: 0,
  };

  it("uses a two-column playboard grid on md+", () => {
    const { container } = render(<YatzyTable {...defaultProps} />);
    const board = container.querySelector(".yatzy-board");
    expect(board?.className).toMatch(/md:grid/);
    expect(board?.className).toMatch(/md:grid-cols-\[minmax\(0\,0\.42fr\)_minmax\(0\,0\.58fr\)\]/);
  });

  it("hides standings below md and keeps a slim strip class for desktop", () => {
    render(<YatzyTable {...defaultProps} />);
    const standings = screen.getByTestId("standings");
    expect(standings.className).toMatch(/hidden/);
    expect(standings.className).toMatch(/md:block/);
    expect(screen.queryByText(/live totals update/i)).not.toBeInTheDocument();
  });

  it("starts with a collapsed mobile status strip and expands on toggle", async () => {
    const user = userEvent.setup();
    render(<YatzyTable {...defaultProps} />);

    expect(screen.queryByText(/your turn\. roll, hold/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /expand status/i }));
    expect(screen.getByText(/your turn\. roll, hold/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /collapse status/i }));
    expect(screen.queryByText(/your turn\. roll, hold/i)).not.toBeInTheDocument();
  });

  it("keeps desktop status details visible without requiring expand", () => {
    render(<YatzyTable {...defaultProps} />);
    const details = screen.getByTestId("status-details");
    expect(details.className).toMatch(/md:block/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/YatzyTable.test.tsx`

Expected: FAIL — module / selectors / buttons missing

- [ ] **Step 3: Write minimal implementation**

Rewrite `YatzyTable.tsx` structure (keep ChatPanel + intent wiring). Key shape:

```tsx
export function YatzyTable(props: YatzyTableProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [statusExpanded, setStatusExpanded] = useState(false);
  // ... existing currentPlayer / playerLabels ...

  const statusHeadline =
    props.state.phase === "finished"
      ? "Final scores"
      : `${playerLabels[currentPlayerId ?? ""] ?? "Next up"} to roll`;

  const statusHelper =
    props.state.phase === "finished"
      ? `Winner: ${props.state.winnerIds.map((playerId) => playerLabels[playerId] ?? playerId).join(", ")}`
      : isCurrentPlayer
        ? "Your turn. Roll, hold, then lock in a category."
        : "Watch the dice, then pounce when your turn swings back.";

  return (
    <>
      <div className="yatzy-board mt-0 grid gap-5 md:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] md:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="rounded-[2rem] bg-[linear-gradient(135deg,var(--color-coral),var(--color-mango))] p-4 text-white shadow-[0_20px_50px_rgba(238,108,77,0.32)] md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-white/80">
                  {props.state.ruleset}
                </p>
                <div className="mt-2 flex items-center gap-2 md:mt-3">
                  <h1 className="font-display text-2xl leading-none md:text-4xl">
                    {statusHeadline}
                  </h1>
                  <button
                    type="button"
                    className="rounded-xl bg-white/20 px-2 py-1 text-xs font-semibold text-white backdrop-blur md:hidden"
                    aria-expanded={statusExpanded}
                    aria-label={statusExpanded ? "Collapse status" : "Expand status"}
                    onClick={() => setStatusExpanded((open) => !open)}
                  >
                    {statusExpanded ? "▴" : "▾"}
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="rounded-2xl bg-white/20 px-4 py-3 text-sm font-semibold text-white backdrop-blur"
                onClick={() => setChatOpen(true)}
              >
                Chat
              </button>
            </div>

            <div
              data-testid="status-details"
              className={[statusExpanded ? "block" : "hidden", "md:block"].join(" ")}
            >
              <p className="mt-3 text-sm text-white/85">{statusHelper}</p>
              <div className="mt-4 flex flex-wrap gap-3 md:mt-5">
                {props.meta.seatUserIds.map((playerId) => {
                  const online = props.onlineUserIds.includes(playerId);
                  const active = playerId === currentPlayerId;
                  return (
                    <div
                      key={playerId}
                      className={[
                        "rounded-full px-4 py-2 text-sm font-semibold",
                        active ? "bg-white text-[var(--color-ink)]" : "bg-white/15 text-white",
                      ].join(" ")}
                    >
                      <span className={online ? "text-[var(--color-teal)]" : "text-white/40"}>
                        ●
                      </span>{" "}
                      {playerLabels[playerId] ?? playerId}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <DiceTray
            dice={props.state.dice}
            holds={props.state.holds}
            rollsLeft={props.state.rollsLeft}
            canRoll={
              isCurrentPlayer && props.state.phase !== "finished" && props.state.rollsLeft > 0
            }
            canToggleHolds={
              isCurrentPlayer &&
              props.state.phase !== "finished" &&
              !props.state.dice.every((die) => die === 0)
            }
            rollVersion={props.rollVersion}
            onRoll={() => props.onIntent("roll", {})}
            onToggleHold={(index) => {
              const nextHolds = props.state.holds.map((held, heldIndex) =>
                heldIndex === index ? !held : held,
              );
              props.onIntent("set_holds", { holds: nextHolds });
            }}
          />

          <section
            data-testid="standings"
            className="hidden rounded-[1.5rem] border border-white/70 bg-white/85 p-4 shadow-[0_20px_60px_rgba(26,26,26,0.1)] backdrop-blur md:block"
          >
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--color-coral)]">
              Standings
            </p>
            <div className="mt-3 grid gap-2">
              {props.state.playerIds.map((playerId) => (
                <motion.div
                  key={playerId}
                  layout
                  className="flex items-center justify-between rounded-2xl bg-[var(--color-cream)] px-3 py-2"
                >
                  <span className="font-semibold text-[var(--color-ink)]">
                    {playerLabels[playerId] ?? playerId}
                  </span>
                  <span className="font-display text-xl text-[var(--color-ink)]">
                    {totalScore(props.state, playerId)}
                  </span>
                </motion.div>
              ))}
            </div>
          </section>
        </div>

        <div className="min-h-0 min-w-0 md:sticky md:top-4 md:max-h-[calc(100dvh-6rem)]">
          <ScoreSheet
            state={props.state}
            playerLabels={playerLabels}
            currentUserId={props.currentUserId}
            canScore={isCurrentPlayer && props.state.phase !== "finished"}
            onScore={(category) => props.onIntent("score", { category })}
          />
        </div>
      </div>

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={props.messages}
        playerLabels={playerLabels}
        canSend
        onSend={props.onSendChat}
      />
    </>
  );
}
```

Notes for the implementer:

- Remove the old full-width stacked standings block that always rendered.
- Expand toggle is **`md:hidden`** so desktop never needs it; details use `hidden` + `md:block` (plus `block` when expanded).
- Sticky right column is optional polish that supports in-panel sheet scroll; keep if tests pass.
- Do not alter ChatPanel behavior.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @roundhouse/web test src/games/yatzy/YatzyTable.test.tsx src/games/yatzy/DiceTray.test.tsx src/games/yatzy/ScoreSheet.test.tsx src/games/yatzy/DieFace.test.tsx
```

Expected: PASS

- [ ] **Step 5: Manual smoke (implementer)**

- Laptop width: two columns; dice ~56–64px; standings under dice; sheet usable without hunting page scroll.
- Phone width: collapsed strip; expand shows helper + chips; standings hidden; denser rows.
- Chat still opens from banner.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/games/yatzy/YatzyTable.tsx apps/web/src/games/yatzy/YatzyTable.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add balanced responsive Yatzy playboard

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement                        | Task                                |
| --------------------------------------- | ----------------------------------- |
| Desktop side-by-side ~42/58             | Task 3                              |
| Capped dice, no blow-up                 | Task 1                              |
| Mobile compact status strip + expand    | Task 3                              |
| Dense mobile score rows                 | Task 2                              |
| Standings desktop-only under dice       | Task 3                              |
| Sheet in-panel scroll on desktop        | Task 2 (+ sticky wrapper in Task 3) |
| No logic/chat/DieFace/lobby changes     | All tasks                           |
| Unit tests for banner + standings       | Task 3                              |
| Existing preview / die tests still pass | Task 2 Step 4 / Task 3 Step 4       |
