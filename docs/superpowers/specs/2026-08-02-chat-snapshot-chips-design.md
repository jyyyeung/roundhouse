# Chat snapshot — compact dice chips

Date: 2026-08-02  
Status: approved for planning

## Goal

Chat messages with an attached game snapshot currently render a nested “Snapshot” card (digits string, `Holds: HHH--`, rolls left). That makes each message tall and hard to scan.

Replace it with a single compact chip row under the username that shows dice values and visually distinguishes held vs free dice.

## Decisions

| Topic | Choice |
|---|---|
| Layout | Mini chips under name/time, above message body |
| Face content | Arabic digits (not pips / not `DieFace`) |
| Held style | Teal fill + deep teal border (mirrors dice tray) |
| Free style | White fill + slate border |
| Rolls left | Do not show in chat |
| Nested Snapshot card | Remove |
| Architecture | Extract `ChatDiceChips`; wire from `ChatPanel` |
| Protocol / snapshot payload | Unchanged (`rollsLeft` may still arrive; UI ignores it) |

## Design

### Message structure

When `readChatSnapshot(message.snapshot).dice.length > 0`:

```
[Name]                         [time]
[6][6][6][4][2]                 ← ChatDiceChips
message text…
```

Plain text messages (no dice) stay unchanged — name/time + body only.

### `ChatDiceChips`

New component: `apps/web/src/games/yatzy/ChatDiceChips.tsx`

- Props: `dice: number[]`, `holds: boolean[]`.
- One ~22×22 rounded square per die; digit centered (`font-display` or equivalent compact weight).
- Held (`holds[i] === true`): `border-[var(--color-teal-deep)]` + `bg-[var(--color-teal)]`.
- Free / missing hold: `border-slate-200` + `bg-white`.
- Row-level `aria-label`, e.g. `Dice 6, 6, 6, 4, 2; held 1–3` (1-based indices of held dice). Digits themselves can be `aria-hidden`.

### `ChatPanel`

- Delete the nested white Snapshot block, “Holds: …”, and rolls-left lines.
- Insert `<ChatDiceChips dice={…} holds={…} />` between the name/time row and the message body when dice exist.
- Keep using `readChatSnapshot`.

## Out of scope

- Pip / soft `DieFace` rendering in chat.
- Showing rolls left in chat.
- Changing chat or snapshot wire format.
- Dice tray or score sheet changes (covered by the separate UI polish spec).

## Verification

- Update `table.test.tsx` (and any ChatPanel assertions) that expect concatenated digits like `66642` or `1 roll left`.
- Assert chip row presence via `aria-label` and/or held vs free class distinction.
- Unit-test `ChatDiceChips` for held/free styling.
- Manual: chat with snapshot is one short meta line; held chips read as teal; free chips stay white.
