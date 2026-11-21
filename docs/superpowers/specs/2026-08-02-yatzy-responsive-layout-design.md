# Yatzy table responsive layout — balanced playboard

Date: 2026-08-02  
Status: approved for planning

## Goal

Make the in-game Yatzy table use available width on laptop/tablet and reclaim vertical space on mobile, without changing game logic, theme, or die-face styling.

Success criteria:

1. **Desktop/tablet (≥ md):** side-by-side layout — play column (status + dice + standings) left, score sheet right — so players rarely need to scroll the whole page to score.
2. **Dice:** fixed visual size (not full-column `aspect-square` blow-up); remain readable and holdable.
3. **Mobile (< md):** coral status collapses to a short strip so dice + most of the score sheet appear without scrolling past a hero banner.
4. **Mobile rows:** dense enough that categories are scannable with dice still in view (or nearly).

## Decisions

| Topic                      | Choice                                                                   |
| -------------------------- | ------------------------------------------------------------------------ |
| Desktop layout             | Side-by-side ~42% / 58% (left play / right sheet)                        |
| Approach                   | Balanced playboard (hero banner kept on desktop; sheet scrolls in-panel) |
| Mobile banner              | Compact strip; expand on tap for helper + chips                          |
| Score density              | Compact (~40–44px touch targets)                                         |
| Standings                  | Desktop only, slim strip under dice; hidden on mobile                    |
| Breakpoint                 | Tailwind `md` (768px)                                                    |
| Die faces / scoring / chat | Unchanged                                                                |

## Design

### Shell / breakpoint

- Keep `TablePage` `max-w-5xl` chrome (header, rematch, errors).
- Layout changes live in `YatzyTable` (and minor padding classes in `DiceTray` / `ScoreSheet`).
- At `md+`: CSS grid two columns. Below `md`: single column stack.

### Desktop (≥ md)

**Left column**

1. Full coral status banner (ruleset, headline, helper copy, player chips, Chat) — slightly tighter padding than today.
2. Dice tray with **capped** die size (~56–64px), row centered; do not let `aspect-square` fill the column width.
3. Slim standings strip: player label + total only (no “Live totals…” subtitle).

**Right column**

- Score sheet fills column height (`min-h-0`, `h-full` / flex grow).
- If categories overflow, the **sheet panel** scrolls (`overflow-y-auto`), not the whole page when possible.
- Cell semantics unchanged (locked value / preview / `—`).

### Mobile (< md)

1. **Status strip (collapsed default):** turn headline + expand control + Chat. Tap expands helper copy + player chips; tap again (or equivalent) collapses. Always starts collapsed; no persistence.
2. Dice tray with smaller cap (~48px).
3. Dense score sheet (tighter `th`/`td`/button padding).
4. Standings section not rendered / `hidden`.

### Components touched

| File             | Change                                                               |
| ---------------- | -------------------------------------------------------------------- |
| `YatzyTable.tsx` | Responsive grid; banner expand state; standings placement/visibility |
| `DiceTray.tsx`   | Cap die button size; center row                                      |
| `ScoreSheet.tsx` | Dense padding; desktop in-panel scroll container classes             |
| Tests            | Layout/banner expand / standings visibility as needed                |

### Out of scope

- Lobby waiting-room layout
- Chat panel layout
- Scoring rules, intents, WebSocket protocol
- Die face redesign / style picker
- Changing `max-w-5xl` page shell or lobby `max-w-md`

## Verification

- Unit tests for banner expand/collapse interaction and standings hidden on the mobile code path (or class assertions).
- Manual: laptop — two columns, dice not huge, sheet usable without chasing the page scroll; phone — compact strip, dense rows, standings gone.
- Existing score preview / die face tests still pass.
