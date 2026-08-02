# Lobby responsive layout — two-column hub

Date: 2026-08-02  
Status: approved for planning

## Goal

Make the authenticated lobby use available width on tablet and desktop without changing mobile layout, auth, table APIs, or visual theme.

Success criteria:

1. **Desktop/tablet (`md+`, ≥768px):** full-width header; Create and Join side-by-side; Recent Tables as denser horizontal rows below.
2. **Mobile (`< md`):** existing single-column `max-w-md` stack unchanged in structure and density.
3. Share URLs on wide viewports are truncated / copyable — not full wrapping localhost strings dominating the row.
4. No changes to create/join/sign-out behavior, rulesets, or in-table/chat layouts.

## Decisions

| Topic | Choice |
|---|---|
| Layout approach | Balanced actions + list (two-column hub) |
| Breakpoint | Tailwind `md` (768px) — same as playboard |
| Shell width (`md+`) | ~`max-w-5xl` with slightly larger horizontal padding |
| Create / Join | Equal 50/50 grid; stretch cards so CTAs align at bottom when possible |
| Recent tables (`md+`) | Horizontal row: name/status, code badge, truncated link + copy, Open button |
| Recent tables (`< md`) | Keep current tall cream cards |
| Theme / copy | Unchanged (Fredoka/Manrope, coral/teal cards, existing button labels) |
| Scope | `lobby.tsx` (+ tests as needed) |

## Design

### Shell / breakpoint

- Below `md`: keep `max-w-md`, `px-4`, vertical stack (header → create → join → recent).
- At `md+`: raise shell to `max-w-5xl` (e.g. `max-w-md md:max-w-5xl`), allow a bit more horizontal padding if needed for breathing room.
- Header remains one full-width coral/mango card spanning the shell.

### Create / Join (`md+`)

- Wrap Create and Join sections in a responsive grid: `md:grid md:grid-cols-2 md:gap-5` (or equivalent).
- Each section stays a white frosted card; content uses flex column with CTA `mt-auto` so primary buttons sit on a shared baseline when card heights differ (e.g. after-create invite panel expands Create only).
- Create: ruleset select + teal “Create …” button; post-create invite block remains inside Create.
- Join: letter-spaced code input + ink “Join table” submit.
- Button label/ruleset-aware polish is out of scope unless already trivial.

### Recent Tables

- Section always full width under the action grid; title + Refresh unchanged.
- **`< md`:** current card layout (ruleset title, code badge, status, full share URL, full-width Open).
- **`md+`:** denser row per table:
  - Left: ruleset display name + `status · seated/cap`
  - Code badge (existing coral pill)
  - Share URL truncated (`truncate` / constrained max-width) with a small Copy control (clipboard write of `buildShareUrl(...)`)
  - Right-aligned “Open table” (not full-width)
- Error message remains at the bottom of this section.

### Components / files

| File | Change |
|---|---|
| `apps/web/src/routes/lobby.tsx` | Responsive shell, action grid, denser recent rows, copy-link control |
| Tests (if present / needed) | Layout class or copy-link behavior assertions as warranted |

### Out of scope

- In-table playboard / chat responsive work
- Lobby waiting-room UI inside `/t/:id`
- Sorting, filtering, or live WS refresh of recent tables
- Theme token changes, new fonts, or card redesign
- Changing create/join API contracts

## Verification

- Manual: phone — unchanged single column; tablet/laptop — two action columns + denser recent rows; create invite still works; join still navigates; Open still navigates; Copy puts share URL on clipboard.
- Existing lobby/auth redirect tests still pass; add focused assertions only if valuable.
