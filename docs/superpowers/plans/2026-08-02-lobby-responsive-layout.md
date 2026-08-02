# Lobby Responsive Layout (Two-Column Hub) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the lobby on tablet/desktop into a two-column Create|Join hub with denser recent-table rows, without changing mobile stack, APIs, or theme.

**Architecture:** Keep all logic in `LobbyPage`. Use Tailwind responsive classes only: raise shell `max-w` at `md`, wrap Create/Join in a 2-col grid, restyle recent-table articles as horizontal rows at `md+` with truncated URL + Copy. No new routes or shared layout components.

**Tech Stack:** React 19, React Router 7, Tailwind CSS 4, Vitest + Testing Library, pnpm workspace `@roundhouse/web`.

## Global Constraints

- Package manager: **pnpm** only.
- Breakpoint: Tailwind **`md` (768px)** — same as playboard.
- Shell: **`max-w-md` below `md`**, **`max-w-5xl` at `md+`**.
- Create|Join: **equal 50/50** grid at `md+`; mobile stays stacked.
- Recent tables: **tall cards below `md`**; **horizontal denser rows at `md+`** with truncated URL + Copy.
- Do **not** change create/join/sign-out APIs, rulesets, theme tokens, in-table, or chat layouts.
- Button labels / section copy stay as today (except adding a “Copy link” control on `md+` rows).

---

## File Structure

```
apps/web/src/routes/
├── lobby.tsx           # MODIFY — responsive shell, action grid, denser rows, copy
└── lobby.test.tsx      # CREATE — layout class + copy-link assertions
```

No other files.

---

### Task 1: Responsive shell + Create|Join grid

**Files:**
- Create: `apps/web/src/routes/lobby.test.tsx`
- Modify: `apps/web/src/routes/lobby.tsx`

**Interfaces:**
- Consumes: existing `LobbyPage({ session })`, `getRecentTables` / `createTable` / `joinTable` / `buildShareUrl` / `authClient`
- Produces: root shell classes `max-w-md md:max-w-5xl`; Create|Join wrapped in `md:grid md:grid-cols-2`; cards use flex column + CTA `mt-auto`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/routes/lobby.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LobbyPage } from "./lobby";
import * as tables from "../lib/tables";

vi.mock("../lib/tables", async () => {
  const actual = await vi.importActual<typeof import("../lib/tables")>("../lib/tables");
  return {
    ...actual,
    getRecentTables: vi.fn(),
    createTable: vi.fn(),
    joinTable: vi.fn(),
  };
});

vi.mock("../lib/auth-client", () => ({
  authClient: {
    signOut: vi.fn(),
  },
}));

const getRecentTables = vi.mocked(tables.getRecentTables);

function renderLobby() {
  return render(
    <MemoryRouter>
      <LobbyPage session={{ user: { name: "Ada", email: "ada@example.com" } }} />
    </MemoryRouter>,
  );
}

describe("LobbyPage layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentTables.mockResolvedValue([]);
  });

  it("widens the shell and grids create/join at md+", async () => {
    const { container } = renderLobby();

    await waitFor(() => {
      expect(getRecentTables).toHaveBeenCalled();
    });

    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toMatch(/max-w-md/);
    expect(shell.className).toMatch(/md:max-w-5xl/);

    const actions = container.querySelector(".lobby-actions");
    expect(actions?.className).toMatch(/md:grid/);
    expect(actions?.className).toMatch(/md:grid-cols-2/);

    expect(screen.getByText(/create table/i)).toBeInTheDocument();
    expect(screen.getByText(/join by code/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roundhouse/web test src/routes/lobby.test.tsx`

Expected: FAIL — missing `md:max-w-5xl` and/or `.lobby-actions` grid classes

- [ ] **Step 3: Write minimal implementation**

In `apps/web/src/routes/lobby.tsx`:

1. Change the root container class from:

```tsx
<div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
```

to:

```tsx
<div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6 md:max-w-5xl md:px-6">
```

2. Wrap the Create and Join `<section>`s in:

```tsx
      <div className="lobby-actions mt-5 grid gap-5 md:grid-cols-2 md:items-stretch">
        <section className="flex h-full flex-col rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur">
          {/* Create contents — keep existing fields */}
          ...
          <button
            type="button"
            className="mt-auto ... existing create button classes ..."
            ...
          >
            ...
          </button>
          {createdTable ? ( /* existing invite panel */ ) : null}
        </section>

        <section className="flex h-full flex-col rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur">
          {/* Join contents */}
          <form className="mt-4 flex flex-1 flex-col space-y-4" onSubmit={handleJoin}>
            <input ... existing ... />
            <button
              type="submit"
              className="mt-auto ... existing join button classes ..."
              ...
            >
              ...
            </button>
          </form>
        </section>
      </div>
```

Notes:
- Remove the old `mt-5` from each section (gap lives on `.lobby-actions`).
- Keep Create button `mt-4` → prefer `mt-auto` (plus `pt-4` if spacing looks tight) so CTAs baseline-align when invite is absent.
- Invite panel stays **after** the Create CTA inside the Create card.
- Header and Recent Tables stay **outside** `.lobby-actions`.
- Recent section keeps its existing `mt-5` and markup for now (Task 2).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @roundhouse/web test src/routes/lobby.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/lobby.tsx apps/web/src/routes/lobby.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): widen lobby shell and grid create/join at md

EOF
)"
```

---

### Task 2: Denser recent-table rows + Copy link

**Files:**
- Modify: `apps/web/src/routes/lobby.tsx`
- Modify: `apps/web/src/routes/lobby.test.tsx`

**Interfaces:**
- Consumes: `buildShareUrl`, existing `RecentTable` fields
- Produces: recent articles with `md:flex` row layout; `Copy link` button that writes share URL via `navigator.clipboard.writeText`

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/routes/lobby.test.tsx`:

```tsx
  it("renders denser recent-table row classes and copies the share url", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    getRecentTables.mockResolvedValue([
      {
        id: "table-1",
        code: "Z2YL8J",
        gameId: "yatzy",
        config: { ruleset: "yatzy" },
        status: "active",
        hostUserId: "user-a",
        softSeatCap: 4,
        createdAt: "2026-08-02T00:00:00.000Z",
        seatUserIds: ["user-a", "user-b"],
      },
    ]);

    const { container } = renderLobby();

    await waitFor(() => {
      expect(screen.getByText("Yatzy")).toBeInTheDocument();
    });

    const row = container.querySelector(".lobby-recent-row");
    expect(row?.className).toMatch(/md:flex/);
    expect(row?.className).toMatch(/md:items-center/);

    const url = screen.getByText(/\/t\/table-1/);
    expect(url.className).toMatch(/md:truncate/);

    const copy = screen.getByRole("button", { name: /copy link/i });
    expect(copy.className).toMatch(/md:inline-flex/);
    expect(copy.className).toMatch(/hidden/);

    await user.click(copy);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/t/table-1"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("code=Z2YL8J"));
  });
```

Also add at top of file if missing:

```tsx
import userEvent from "@testing-library/user-event";
```

Prefer `userEvent.setup()` at the top of the test instead of dynamic import if the static import is present.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @roundhouse/web test src/routes/lobby.test.tsx`

Expected: FAIL — missing `.lobby-recent-row` / Copy link / truncate classes

- [ ] **Step 3: Write minimal implementation**

In `lobby.tsx`, update each recent-table `<article>` roughly as:

```tsx
              <article
                key={table.id}
                className="lobby-recent-row rounded-3xl bg-[var(--color-cream)] p-4 md:flex md:items-center md:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3 md:items-center">
                    <div className="min-w-0">
                      <p className="font-display text-2xl text-[var(--color-ink)] md:text-xl">
                        {table.config?.ruleset === "yahtzee" ? "Yahtzee" : "Yatzy"}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {table.status} · {table.seatUserIds.length}/{table.softSeatCap} seated
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-coral)]">
                      {table.code}
                    </span>
                  </div>

                  <div className="mt-3 flex min-w-0 items-center gap-2 md:mt-2">
                    <p className="min-w-0 flex-1 break-all text-sm text-slate-600 md:truncate md:break-normal">
                      {shareUrl}
                    </p>
                    <button
                      type="button"
                      className="hidden shrink-0 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--color-ink)] md:inline-flex"
                      onClick={() => void navigator.clipboard.writeText(shareUrl)}
                    >
                      Copy link
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className="mt-4 w-full rounded-2xl bg-white px-4 py-3 font-semibold text-[var(--color-ink)] md:mt-0 md:w-auto md:shrink-0"
                  onClick={() => navigate(`/t/${table.id}?code=${table.code}`)}
                >
                  Open table
                </button>
              </article>
```

Keep loading / empty / error blocks unchanged. Do not add copy on mobile (button stays `hidden md:inline-flex`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @roundhouse/web test src/routes/lobby.test.tsx`

Expected: PASS

Also run: `pnpm --filter @roundhouse/web test src/app.test.tsx`

Expected: PASS (guest redirect untouched)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/lobby.tsx apps/web/src/routes/lobby.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): densify lobby recent tables and add copy link

EOF
)"
```

---

## Manual verification (after Task 2)

- Phone / narrow: single column, `max-w-md` feel, full URLs, no Copy visible.
- Tablet/desktop ≥768px: header full width, Create|Join side-by-side, recent rows horizontal, Copy works, Open navigates.
- Create still shows invite panel inside Create card; Join still submits.

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| `md+` shell `max-w-5xl` | Task 1 |
| Header full width | Task 1 (unchanged placement) |
| Create\|Join 50/50 grid | Task 1 |
| CTA baseline align when possible | Task 1 (`mt-auto`) |
| Mobile stack unchanged | Task 1–2 (responsive classes only) |
| Recent denser horizontal rows `md+` | Task 2 |
| Truncated URL + Copy on `md+` | Task 2 |
| Mobile tall cards / full URL | Task 2 (`break-all` below `md`, Copy hidden) |
| No API / theme / table / chat changes | Both (lobby.tsx only) |
