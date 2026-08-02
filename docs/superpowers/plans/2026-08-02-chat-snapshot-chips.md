# Compact Chat Snapshot Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tall nested chat Snapshot card with a compact digit chip row under the username that shows held vs free dice.

**Architecture:** Add a presentational `ChatDiceChips` component (`dice` + `holds`). Wire it into `ChatPanel` between the name/time row and message body when the snapshot has dice. Drop rolls-left and the nested Snapshot chrome. No protocol or server changes.

**Tech Stack:** React 19, Tailwind CSS 4, Vitest + Testing Library, pnpm workspace `@yatzy/web`.

## Global Constraints

- Package manager: **pnpm** only.
- Chip faces: **Arabic digits only** — do not use `DieFace` / pips.
- Held: **`border-[var(--color-teal-deep)]` + `bg-[var(--color-teal)]`**.
- Free / missing hold: **`border-slate-200` + `bg-white`**.
- Do **not** render rolls left in chat.
- Do **not** change chat/snapshot wire format or server code.
- Do **not** change dice tray or score sheet in this plan.

---

## File Structure

```
apps/web/src/games/yatzy/
├── ChatDiceChips.tsx        # NEW — compact digit chips
├── ChatDiceChips.test.tsx   # NEW
├── ChatPanel.tsx            # MODIFY — use ChatDiceChips; drop Snapshot card
├── model.ts                 # unchanged (keep readChatSnapshot)
└── …

apps/web/src/routes/
└── table.test.tsx           # MODIFY — assert chip aria-label, not 66642 / rolls left
```

---

### Task 1: `ChatDiceChips` component

**Files:**
- Create: `apps/web/src/games/yatzy/ChatDiceChips.tsx`
- Test: `apps/web/src/games/yatzy/ChatDiceChips.test.tsx`

**Interfaces:**
- Consumes: none
- Produces: `export function ChatDiceChips(props: { dice: number[]; holds: boolean[] }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/games/yatzy/ChatDiceChips.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatDiceChips } from "./ChatDiceChips";

describe("ChatDiceChips", () => {
  it("labels the row with dice values and 1-based held indices", () => {
    render(<ChatDiceChips dice={[6, 6, 6, 4, 2]} holds={[true, true, true, false, false]} />);

    expect(screen.getByLabelText("Dice 6, 6, 6, 4, 2; held 1, 2, 3")).toBeInTheDocument();
  });

  it("omits the held clause when nothing is held", () => {
    render(<ChatDiceChips dice={[1, 2, 3, 4, 5]} holds={[false, false, false, false, false]} />);

    expect(screen.getByLabelText("Dice 1, 2, 3, 4, 5")).toBeInTheDocument();
  });

  it("treats missing holds as free and styles held chips with teal classes", () => {
    const { container } = render(<ChatDiceChips dice={[6, 4]} holds={[true]} />);

    const chips = container.querySelectorAll("[data-chip]");
    expect(chips).toHaveLength(2);
    expect(chips[0]?.className).toMatch(/bg-\[var\(--color-teal\)\]/);
    expect(chips[0]?.className).toMatch(/border-\[var\(--color-teal-deep\)\]/);
    expect(chips[1]?.className).toMatch(/bg-white/);
    expect(chips[1]?.className).toMatch(/border-slate-200/);
    expect(screen.getByLabelText("Dice 6, 4; held 1")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @yatzy/web test src/games/yatzy/ChatDiceChips.test.tsx`

Expected: FAIL (module `./ChatDiceChips` not found, or `ChatDiceChips` undefined)

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/games/yatzy/ChatDiceChips.tsx`:

```tsx
type ChatDiceChipsProps = {
  dice: number[];
  holds: boolean[];
};

function chipLabel(dice: number[], holds: boolean[]) {
  const values = dice.join(", ");
  const held = dice
    .map((_, index) => (holds[index] ? index + 1 : null))
    .filter((index): index is number => index !== null);

  if (held.length === 0) return `Dice ${values}`;
  return `Dice ${values}; held ${held.join(", ")}`;
}

export function ChatDiceChips(props: ChatDiceChipsProps) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label={chipLabel(props.dice, props.holds)}>
      {props.dice.map((value, index) => {
        const held = props.holds[index] === true;

        return (
          <span
            key={index}
            data-chip=""
            data-held={held ? "" : undefined}
            aria-hidden="true"
            className={[
              "inline-grid size-[22px] place-items-center rounded-md border-[1.5px] font-display text-xs font-semibold text-[var(--color-ink)]",
              held
                ? "border-[var(--color-teal-deep)] bg-[var(--color-teal)]"
                : "border-slate-200 bg-white",
            ].join(" ")}
          >
            {value}
          </span>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @yatzy/web test src/games/yatzy/ChatDiceChips.test.tsx`

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/games/yatzy/ChatDiceChips.tsx apps/web/src/games/yatzy/ChatDiceChips.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add ChatDiceChips for compact chat snapshots

EOF
)"
```

---

### Task 2: Wire chips into `ChatPanel` and update table test

**Files:**
- Modify: `apps/web/src/games/yatzy/ChatPanel.tsx`
- Modify: `apps/web/src/routes/table.test.tsx`
- Test: `apps/web/src/routes/table.test.tsx`
- Test: `apps/web/src/games/yatzy/ChatDiceChips.test.tsx` (regression)

**Interfaces:**
- Consumes: `ChatDiceChips` from Task 1; existing `readChatSnapshot`
- Produces: chat messages with dice render chips under the username; no nested Snapshot card / holds string / rolls-left line

- [ ] **Step 1: Update the failing integration assertion**

In `apps/web/src/routes/table.test.tsx`, inside `it("renders chat snapshots from realtime messages", …)`, replace:

```tsx
expect(await screen.findByText("Nice roll")).toBeInTheDocument();
expect(screen.getByText(/66642/i)).toBeInTheDocument();
expect(screen.getByText(/1 roll left/i)).toBeInTheDocument();
```

with:

```tsx
expect(await screen.findByText("Nice roll")).toBeInTheDocument();
expect(screen.getByLabelText("Dice 6, 6, 6, 4, 2; held 1, 2, 3")).toBeInTheDocument();
expect(screen.queryByText(/1 roll left/i)).not.toBeInTheDocument();
expect(screen.queryByText(/Snapshot/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @yatzy/web test src/routes/table.test.tsx`

Expected: FAIL — still finds old Snapshot / concatenated digits UI, missing new `aria-label`

- [ ] **Step 3: Wire `ChatPanel`**

Update `apps/web/src/games/yatzy/ChatPanel.tsx`:

1. Add import:

```tsx
import { ChatDiceChips } from "./ChatDiceChips";
```

Keep existing:

```tsx
import { readChatSnapshot, type TableChatMessage } from "./model";
```

2. Replace the message article body so the chip row sits under the name/time row and above the text. Full message map render:

```tsx
{props.messages.map((message) => {
  const snapshot = readChatSnapshot(message.snapshot);
  const label = props.playerLabels[message.userId] ?? message.userId;

  return (
    <article key={message.id} className="rounded-[1.5rem] bg-[var(--color-cream)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--color-ink)]">{label}</p>
        <time className="text-xs text-slate-500">
          {new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </time>
      </div>
      {snapshot.dice.length > 0 ? <ChatDiceChips dice={snapshot.dice} holds={snapshot.holds} /> : null}
      <p className="mt-2 text-sm leading-6 text-slate-700">{message.text}</p>
    </article>
  );
})}
```

Delete the nested Snapshot block entirely (the `rounded-2xl bg-white/80` section with “Snapshot”, joined digits, “Holds:”, and rolls left).

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @yatzy/web test src/games/yatzy/ChatDiceChips.test.tsx src/routes/table.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/games/yatzy/ChatPanel.tsx apps/web/src/routes/table.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): render compact dice chips in chat snapshots

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Mini chips under name/time, above body | Task 2 |
| Arabic digits | Task 1 |
| Held teal fill + deep teal border | Task 1 |
| Free white + slate border | Task 1 |
| No rolls left in chat | Task 2 |
| Remove nested Snapshot card | Task 2 |
| `ChatDiceChips` extraction | Task 1 |
| Payload unchanged | both (no server/model edits) |
| Update table test away from `66642` / rolls left | Task 2 |
| Unit-test held/free styling | Task 1 |

No placeholders. Aria-label format locked to `Dice a, b, …; held i, j, …` (omit held clause when empty). Missing `holds[i]` treated as free.
