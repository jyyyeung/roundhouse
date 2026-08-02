# Chat responsive layout — dock, overlay, mobile composer

Date: 2026-08-02  
Status: approved for planning

## Goal

Make in-table chat usable across viewports: always visible on wide desktops, overlay on mid widths, and a floating send bar on mobile so players can message without opening the history sheet.

Success criteria:

1. **`xl+` (≥1280px):** chat docks as a persistent right rail beside the playboard (not a third board column). Always visible; no backdrop/slide.
2. **Below `xl`:** keep the existing overlay drawer opened from the banner Chat button.
3. **Below `md`:** when overlay is closed, show a floating bottom composer (edit + send); hide it while overlay is open. Draft text is shared with the overlay/dock composer.
4. No chat protocol, server, snapshot, or scoring changes.

## Decisions

| Topic | Choice |
|---|---|
| Approach | Modeful `ChatPanel` (`dock` \| `overlay`) + extracted `ChatComposer` |
| Desktop placement | Right rail **outside** the play \| sheet board (option B) |
| Dock breakpoint | Tailwind **`xl` (1280px)** |
| Playboard breakpoint | Unchanged — `md` two-column board |
| Mobile float | Always-visible bottom composer when overlay closed (option A) |
| Draft | Controlled/shared across float + panel |
| Banner Chat button | Hidden at `xl+` (`xl:hidden`) |
| Unread / notifications / protocol | **Out of scope** (later) |

## Design

### Viewport behavior

| Viewport | Chat UI |
|---|---|
| `xl+` | Docked rail always mounted. `mode="dock"`. Banner Chat hidden. |
| `md`–`lg` | Overlay drawer. Banner Chat toggles `chatOpen`. |
| `< md` | Overlay for history + floating composer when `!chatOpen`. |

### Shell / layout

- Keep chat ownership in `YatzyTable` (not lifted to `table.tsx` unless needed).
- Wrap playboard + chat in an `xl` grid, e.g. `xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]`, so the existing `yatzy-board` 42/58 grid is unchanged inside the first column.
- Widen the table page shell at `xl` so board + rail fit (e.g. `table.tsx` `max-w-5xl` → `xl:max-w-7xl`). Mid/narrow widths keep `max-w-5xl`.
- Dock height: fill available column (`h-full` / `min-h-0`) with message list scrolling in-panel.

### `ChatPanel`

- Props: existing `messages`, `playerLabels`, `canSend`, `onSend`, `open`, `onClose`; add required `mode: "dock" | "overlay"`; required controlled `draft` + `onDraftChange`.
- **Dock:** static aside (not `fixed` slide-in), no backdrop, no Close control; `open`/`onClose` ignored for visibility.
- **Overlay:** current behavior — fixed right drawer, backdrop, Close; gated by `open`.
- Message list + snapshot chips unchanged (`ChatDiceChips` / `readChatSnapshot`).
- Footer uses shared `ChatComposer`.

### `ChatComposer`

- Presentational: text field + send; submits trimmed text via `onSend`; parent clears draft after send.
- Used by: dock footer, overlay footer, mobile float.
- **Float:** fixed bottom, safe-area padding, compact single-line field + send; `z-index` below overlay (`z-20` vs overlay `z-30`/`z-40`). Render only when `mode === "overlay" && !chatOpen`, and only below `md` (`md:hidden` or equivalent gate).

### `YatzyTable` wiring

- State: `chatOpen` (overlay only), shared `draft`.
- Resolve mode with `matchMedia("(min-width: 1280px)")` (Tailwind `xl`) so a **single** `ChatPanel` mount switches dock ↔ overlay without dual trees. Subscribe to changes on resize.
- At `xl+`: `mode="dock"` (always visible); ignore `chatOpen` for panel visibility.
- Below `xl`: `mode="overlay"`, `open={chatOpen}`.
- Floating composer sibling when `mode === "overlay" && !chatOpen` (CSS-hidden at `md+`).

### Data flow

```
YatzyTable
  draft / setDraft
  chatOpen / setChatOpen
  onSendChat(text)  → existing WS path (server snapshot unchanged)
    ├─ ChatPanel (dock | overlay) → ChatComposer
    └─ ChatComposer (mobile float, < md && !chatOpen)
```

### Out of scope

- Unread badges, toasts, notification sounds
- Last-read / protocol / server changes
- Lobby or waiting-room chat
- Changing snapshot chip UI
- Rematch / lobby layout

## Components touched

| File | Change |
|---|---|
| `ChatPanel.tsx` | Dock/overlay modes; controlled draft; use `ChatComposer` |
| `ChatComposer.tsx` | **New** — shared input + send |
| `YatzyTable.tsx` | `xl` board\|rail grid; mode wiring; float; hide Chat at `xl` |
| `table.tsx` | Widen shell at `xl` (`max-w-7xl`) |
| Tests | Dock vs overlay structure; float visibility; Chat `xl:hidden`; regression on chips/table |

## Verification

- Unit: dock has no backdrop / no Close; overlay keeps them when open.
- Unit: banner Chat has `xl:hidden`; float present only when overlay closed (class/role assertions).
- Existing chat snapshot + table tests still pass.
- Manual: wide desktop dock always on; shrink below `xl` → overlay; phone → send from float without opening history; open Chat → draft continuity; message appears with chips if in-game.
