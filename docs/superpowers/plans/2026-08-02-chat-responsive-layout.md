# Chat Responsive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dock chat as a persistent right rail at `xl+`, keep the overlay drawer below that, and add a mobile floating composer for quick sends when the overlay is closed.

**Architecture:** Extract shared `ChatComposer`. Teach `ChatPanel` `dock` | `overlay` modes with controlled draft. `YatzyTable` resolves mode via `matchMedia("(min-width: 1280px)")`, wraps board+rail in an `xl` grid, hides banner Chat at `xl`, and mounts a floating composer below `md` when overlay is closed. Widen `table.tsx` shell to `xl:max-w-7xl`. No protocol/server changes.

**Tech Stack:** React 19, Tailwind CSS 4, Motion (existing overlay), Vitest + Testing Library, pnpm workspace `@roundhouse/web`.

## Global Constraints

- Package manager: **pnpm** only.
- Dock breakpoint: Tailwind **`xl` (1280px)** — `matchMedia("(min-width: 1280px)")`.
- Playboard breakpoint: unchanged **`md` (768px)**.
- Placement: right rail **outside** play \| sheet (not a third board column).
- Floating composer: only when `mode === "overlay" && !chatOpen`, CSS-hidden at `md+`.
- Shared controlled draft across float + panel; clear after send.
- Banner Chat button: **`xl:hidden`**.
- Do **not** change chat protocol, server, snapshot chips, scoring, or lobby.
- Unread / notifications: out of scope.

---

## File Structure

```
apps/web/src/games/yatzy/
├── ChatComposer.tsx           # NEW — shared draft input + send
├── ChatComposer.test.tsx      # NEW
├── ChatPanel.tsx              # MODIFY — dock|overlay; controlled draft; ChatComposer
├── ChatPanel.test.tsx         # NEW
├── YatzyTable.tsx             # MODIFY — matchMedia mode; xl grid; float; Chat xl:hidden
├── YatzyTable.test.tsx        # MODIFY — chat layout assertions
├── ChatDiceChips.tsx          # unchanged
└── …

apps/web/src/routes/
├── table.tsx                  # MODIFY — xl:max-w-7xl on active table shell
└── table.test.tsx             # unchanged unless Chat click breaks (keep overlay default in jsdom)
```

---

### Task 1: `ChatComposer`

**Files:**

- Create: `apps/web/src/games/yatzy/ChatComposer.tsx`
- Create: `apps/web/src/games/yatzy/ChatComposer.test.tsx`

**Interfaces:**

- Consumes: none
- Produces:

```ts
export type ChatComposerProps = {
  draft: string;
  onDraftChange: (value: string) => void;
  canSend: boolean;
  onSend: (text: string) => void;
  variant: "panel" | "float";
};
export function ChatComposer(props: ChatComposerProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/games/yatzy/ChatComposer.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatComposer } from "./ChatComposer";

describe("ChatComposer", () => {
  it("sends trimmed text and does not send empty/whitespace", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onDraftChange = vi.fn();

    const { rerender } = render(
      <ChatComposer
        draft="  hello  "
        onDraftChange={onDraftChange}
        canSend
        onSend={onSend}
        variant="panel"
      />,
    );

    await user.click(screen.getByRole("button", { name: /send message/i }));
    expect(onSend).toHaveBeenCalledWith("hello");

    onSend.mockClear();
    rerender(
      <ChatComposer
        draft="   "
        onDraftChange={onDraftChange}
        canSend
        onSend={onSend}
        variant="panel"
      />,
    );
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  it("uses a single-line textbox for float variant", () => {
    render(
      <ChatComposer draft="" onDraftChange={vi.fn()} canSend onSend={vi.fn()} variant="float" />,
    );
    const box = screen.getByRole("textbox", { name: /message/i });
    expect(box.tagName).toBe("INPUT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/ChatComposer.test.tsx`

Expected: FAIL — module `./ChatComposer` not found

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/games/yatzy/ChatComposer.tsx`:

```tsx
import { type FormEvent } from "react";

export type ChatComposerProps = {
  draft: string;
  onDraftChange: (value: string) => void;
  canSend: boolean;
  onSend: (text: string) => void;
  variant: "panel" | "float";
};

export function ChatComposer(props: ChatComposerProps) {
  const trimmed = props.draft.trim();
  const disabled = !props.canSend || trimmed.length === 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    props.onSend(trimmed);
  }

  if (props.variant === "float") {
    return (
      <form className="flex items-center gap-2" onSubmit={handleSubmit}>
        <input
          type="text"
          className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-coral)]"
          placeholder="Call your shot..."
          aria-label="Message"
          value={props.draft}
          onChange={(event) => props.onDraftChange(event.target.value)}
          maxLength={500}
          disabled={!props.canSend}
        />
        <button
          type="submit"
          className="shrink-0 rounded-2xl bg-[var(--color-coral)] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          aria-label="Send message"
        >
          Send
        </button>
      </form>
    );
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <textarea
        className="min-h-28 w-full resize-none rounded-[1.5rem] border border-slate-200 bg-white px-4 py-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-coral)]"
        placeholder="Call your shot..."
        aria-label="Message"
        value={props.draft}
        onChange={(event) => props.onDraftChange(event.target.value)}
        maxLength={500}
        disabled={!props.canSend}
      />
      <button
        type="submit"
        className="w-full rounded-2xl bg-[var(--color-coral)] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
      >
        Send message
      </button>
    </form>
  );
}
```

Note: parent clears `draft` after `onSend` (not `ChatComposer`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/ChatComposer.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/games/yatzy/ChatComposer.tsx apps/web/src/games/yatzy/ChatComposer.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add ChatComposer for shared chat draft send

EOF
)"
```

---

### Task 2: Modeful `ChatPanel`

**Files:**

- Modify: `apps/web/src/games/yatzy/ChatPanel.tsx`
- Create: `apps/web/src/games/yatzy/ChatPanel.test.tsx`

**Interfaces:**

- Consumes: `ChatComposer` from Task 1; `ChatDiceChips`; `readChatSnapshot`; `TableChatMessage`
- Produces:

```ts
type ChatPanelProps = {
  mode: "dock" | "overlay";
  open: boolean;
  onClose: () => void;
  messages: TableChatMessage[];
  playerLabels: Record<string, string>;
  canSend: boolean;
  onSend: (text: string) => void;
  draft: string;
  onDraftChange: (value: string) => void;
};
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/games/yatzy/ChatPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatPanel } from "./ChatPanel";

const baseProps = {
  open: true,
  onClose: vi.fn(),
  messages: [],
  playerLabels: { "user-a": "You" },
  canSend: true,
  onSend: vi.fn(),
  draft: "",
  onDraftChange: vi.fn(),
};

describe("ChatPanel", () => {
  it("overlay renders backdrop and Close when open", () => {
    render(<ChatPanel {...baseProps} mode="overlay" />);
    expect(screen.getByRole("button", { name: /close chat/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
  });

  it("dock renders without backdrop or Close and stays visible", () => {
    render(<ChatPanel {...baseProps} mode="dock" open={false} />);
    expect(screen.getByText(/^chat$/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close chat/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^close$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /message/i })).toBeInTheDocument();
  });

  it("overlay renders nothing when closed", () => {
    const { container } = render(<ChatPanel {...baseProps} mode="overlay" open={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/ChatPanel.test.tsx`

Expected: FAIL — missing `mode` / always-overlay behavior / dock still uses fixed drawer

- [ ] **Step 3: Write minimal implementation**

Rewrite `apps/web/src/games/yatzy/ChatPanel.tsx` to:

1. Remove internal `useState` draft; use `props.draft` / `props.onDraftChange`.
2. Pass `onSend={props.onSend}` straight into `ChatComposer`. Do **not** clear draft here — `YatzyTable.handleSendChat` clears after `onSendChat`.

3. Dock branch (always show body):

```tsx
<aside
  data-testid="chat-panel"
  className="flex h-full min-h-0 w-full flex-col border border-white/60 bg-white/96 p-5 shadow-[0_20px_60px_rgba(26,26,26,0.1)] backdrop-blur xl:rounded-[2rem]"
>
  {/* header without Close */}
  {/* message list — same as today */}
  <ChatComposer
    variant="panel"
    draft={props.draft}
    onDraftChange={props.onDraftChange}
    canSend={props.canSend}
    onSend={props.onSend}
  />
</aside>;
```

4. Overlay branch: keep `AnimatePresence` + backdrop (`aria-label="Close chat"`) + sliding `aside` + Close button; only when `props.open`. Footer = same `ChatComposer variant="panel"`.

5. Shared message list: extract a local `function MessageList(...)` inside the file or duplicate minimally — prefer a small inner function to avoid drift.

Full shape sketch:

```tsx
export function ChatPanel(props: ChatPanelProps) {
  const body = (
    <>
      <header>...</header>
      <div className="mt-5 flex-1 space-y-3 overflow-y-auto pr-1">...</div>
      <div className="mt-5">
        <ChatComposer
          variant="panel"
          draft={props.draft}
          onDraftChange={props.onDraftChange}
          canSend={props.canSend}
          onSend={props.onSend}
        />
      </div>
    </>
  );

  if (props.mode === "dock") {
    return (
      <aside data-testid="chat-panel" className="flex h-full min-h-0 w-full flex-col ...">
        {body with dock header (no Close)}
      </aside>
    );
  }

  return (
    <AnimatePresence>
      {props.open ? (
        <>
          <motion.button aria-label="Close chat" ... />
          <motion.aside data-testid="chat-panel" className="fixed inset-y-0 right-0 z-40 ...">
            {body with Close}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
```

Keep existing message bubble markup + `ChatDiceChips`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/ChatPanel.test.tsx src/games/yatzy/ChatComposer.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/games/yatzy/ChatPanel.tsx apps/web/src/games/yatzy/ChatPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add dock and overlay modes to ChatPanel

EOF
)"
```

---

### Task 3: Wire `YatzyTable` + widen table shell

**Files:**

- Modify: `apps/web/src/games/yatzy/YatzyTable.tsx`
- Modify: `apps/web/src/games/yatzy/YatzyTable.test.tsx`
- Modify: `apps/web/src/routes/table.tsx` (active shell `max-w-5xl` → `max-w-5xl xl:max-w-7xl`)
- Regression: `pnpm --filter @roundhouse/web test src/routes/table.test.tsx src/games/yatzy/`

**Interfaces:**

- Consumes: `ChatPanel` (Task 2), `ChatComposer` (Task 1)
- Produces: same public `YatzyTableProps`; internal `chatOpen`, `draft`, `chatMode` (`"dock" | "overlay"`)

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/games/yatzy/YatzyTable.test.tsx`:

```tsx
function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("YatzyTable chat layout", () => {
  beforeEach(() => {
    mockMatchMedia(false); // overlay / < xl by default
  });

  it("hides banner Chat at xl via class", () => {
    render(<YatzyTable {...defaultProps} />);
    const chatButton = screen.getByRole("button", { name: /^chat$/i });
    expect(chatButton.className).toMatch(/xl:hidden/);
  });

  it("shows floating composer when overlay closed", () => {
    render(<YatzyTable {...defaultProps} />);
    expect(screen.getByTestId("chat-float-composer")).toBeInTheDocument();
    expect(screen.getByTestId("chat-float-composer").className).toMatch(/md:hidden/);
  });

  it("hides floating composer when overlay is open", async () => {
    const user = userEvent.setup();
    render(<YatzyTable {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /^chat$/i }));
    expect(screen.queryByTestId("chat-float-composer")).not.toBeInTheDocument();
  });

  it("docks chat beside the board at xl and skips the float", () => {
    mockMatchMedia(true);
    const { container } = render(<YatzyTable {...defaultProps} />);
    const shell = container.querySelector(".yatzy-chat-shell");
    expect(shell?.className).toMatch(/xl:grid/);
    expect(shell?.className).toMatch(/xl:grid-cols-\[minmax\(0,1fr\)_minmax\(18rem,22rem\)\]/);
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-float-composer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close chat/i })).not.toBeInTheDocument();
  });

  it("shares draft between float and overlay composer", async () => {
    const user = userEvent.setup();
    render(<YatzyTable {...defaultProps} />);
    const floatInput = screen.getByTestId("chat-float-composer").querySelector("input");
    expect(floatInput).toBeTruthy();
    await user.type(floatInput!, "banter");
    await user.click(screen.getByRole("button", { name: /^chat$/i }));
    expect(screen.getByRole("textbox", { name: /message/i })).toHaveValue("banter");
  });
});
```

Also add a focused assertion in `table.tsx` tests **only if** an existing test queries the shell class; otherwise cover shell widen with a one-liner unit assertion by exporting nothing — instead add this tiny test in `YatzyTable` file is enough for layout; for `table.tsx`, change class and verify manually / optional:

In Task 3 implementation, change:

```tsx
<div className="mx-auto flex min-h-dvh w-full max-w-5xl xl:max-w-7xl flex-col px-4 py-6">
```

If `table.test.tsx` has no shell assertion, skip adding one (YAGNI) — class change is trivial.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @roundhouse/web test src/games/yatzy/YatzyTable.test.tsx`

Expected: FAIL — missing float / shell / xl:hidden / draft share

- [ ] **Step 3: Implement wiring**

In `YatzyTable.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { ChatComposer } from "./ChatComposer";
import { ChatPanel } from "./ChatPanel";
// ...

function useXlChatDock() {
  const [dock, setDock] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1280px)").matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const onChange = () => setDock(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return dock;
}

export function YatzyTable(props: YatzyTableProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [statusExpanded, setStatusExpanded] = useState(false);
  const chatDocked = useXlChatDock();
  const chatMode = chatDocked ? "dock" : "overlay";

  function handleSendChat(text: string) {
    props.onSendChat(text);
    setDraft("");
  }

  // ... playerLabels / status unchanged ...

  return (
    <>
      <div className="yatzy-chat-shell mt-0 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:items-start xl:gap-5">
        <div className="yatzy-board grid gap-5 md:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] md:items-start">
          {/* existing left + right columns unchanged, except Chat button: */}
          <button
            type="button"
            className="rounded-2xl bg-white/20 px-4 py-3 text-sm font-semibold text-white backdrop-blur xl:hidden"
            onClick={() => setChatOpen(true)}
          >
            Chat
          </button>
          {/* ... rest of board ... */}
        </div>

        <div
          className={
            chatMode === "dock" ? "hidden min-h-0 xl:block xl:h-[calc(100dvh-6rem)]" : "contents"
          }
        >
          {/* For overlay, ChatPanel is fixed portal-like; keep it as sibling.
              Simpler approach: always render ChatPanel as next sibling of board
              inside the shell; dock uses grid cell, overlay uses fixed positioning
              so grid cell can be `contents` or empty below xl. */}
          <ChatPanel
            mode={chatMode}
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            messages={props.messages}
            playerLabels={playerLabels}
            canSend
            onSend={handleSendChat}
            draft={draft}
            onDraftChange={setDraft}
          />
        </div>
      </div>

      {chatMode === "overlay" && !chatOpen ? (
        <div
          data-testid="chat-float-composer"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-white/60 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(26,26,26,0.12)] backdrop-blur md:hidden"
        >
          <ChatComposer
            variant="float"
            draft={draft}
            onDraftChange={setDraft}
            canSend
            onSend={handleSendChat}
          />
        </div>
      ) : null}
    </>
  );
}
```

**Grid/dock mounting note (implement exactly):**

- Shell: `yatzy-chat-shell` with `xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:gap-5 xl:items-start`.
- Move existing `yatzy-board` **inside** the shell as first child (keep its `md:` two-column classes; remove any outer `mt-0` conflict — shell gets `mt-0`).
- Second shell child: when `chatMode === "dock"`, a height wrapper `min-h-0 xl:h-[calc(100dvh-6rem)]` containing `ChatPanel mode="dock"`. When overlay, still render `ChatPanel mode="overlay"` as a sibling (fixed, out of flow); use an empty `div` only if needed to keep grid structure — **preferred:** always render `ChatPanel` as second child; dock styles participate in grid; overlay `fixed` ignores grid placement. Do **not** wrap overlay panel in `hidden`.

In `table.tsx` active return shell only:

```tsx
<div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-6 xl:max-w-7xl">
```

Leave lobby/unavailable `max-w-md` shells alone.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @roundhouse/web test \
  src/games/yatzy/ChatComposer.test.tsx \
  src/games/yatzy/ChatPanel.test.tsx \
  src/games/yatzy/YatzyTable.test.tsx \
  src/games/yatzy/ChatDiceChips.test.tsx \
  src/routes/table.test.tsx
```

Expected: PASS (table chat test still clicks Chat — jsdom default `matchMedia` false → overlay)

- [ ] **Step 5: Manual smoke**

- ≥1280px: dock visible, no Chat button, no float, board still 42/58 inside left column.
- 768–1279: Chat opens overlay; no float (`md:hidden`).
- &lt;768: float send works; open Chat hides float; draft persists; close Chat shows float again.

- [ ] **Step 6: Commit**

```bash
git add \
  apps/web/src/games/yatzy/YatzyTable.tsx \
  apps/web/src/games/yatzy/YatzyTable.test.tsx \
  apps/web/src/routes/table.tsx
git commit -m "$(cat <<'EOF'
feat(web): dock chat on xl and add mobile float composer

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement                                 | Task          |
| ------------------------------------------------ | ------------- |
| `xl+` docked right rail outside board            | Task 3        |
| Below `xl` overlay drawer                        | Task 2 + 3    |
| Mobile float when overlay closed; hide when open | Task 3        |
| Shared draft                                     | Task 1–3      |
| Banner Chat `xl:hidden`                          | Task 3        |
| Shell `xl:max-w-7xl`                             | Task 3        |
| `ChatComposer` extraction                        | Task 1        |
| Modeful `ChatPanel`                              | Task 2        |
| No protocol / unread / chips changes             | All tasks     |
| Unit tests dock/overlay/float                    | Tasks 2–3     |
| `table.test` chat snapshots still pass           | Task 3 Step 4 |
