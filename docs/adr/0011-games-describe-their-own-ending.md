# 11. A game describes its own ending; the card is the platform's

- Status: Accepted
- Date: 2026-11-22
- Issue: [#58](https://github.com/jyyyeung/roundhouse/issues/58) (M2-3)

## Context

A finished game already renders its own board, and both games show winners in their own visual
language. What was missing is the thing people actually want at the end: a small, legible card
saying who won, what everyone scored, and one or two facts worth repeating — plus something they can
send to someone who was not there.

The tempting shortcut is a platform component that reads the board. It would rank `view.sheets`
totals for Yatzy, read `view.scores` for Duel, and branch on `gameId` to do it. That is exactly the
coupling that [ADR 0004](0004-games-are-data.md) forbids: the platform would learn two games'
internals, and the third game would have to edit a platform file to be summarised at all.

The opposite shortcut — the server assembling the card and shipping it in the wire — was rejected
too. The card has to render at the end of a _replay_ as well as a live table, and a replay's frames
are the same per-viewer projections the live game sends
([ADR 0009](0009-replay-is-a-projection.md)). A server-built summary would be a second, redundant
payload that could disagree with the board next to it.

## Decision

**A game converts its own projected view into a `GameSummary`; the platform renders that type and
nothing else.**

- `GameSummary` is four optional-ish fields and no knowledge of any game
  (`apps/web/src/lib/summary.ts`): `winners: string[]`, `standings: SummaryStanding[]`,
  `rounds?: number`, `lines?: SummaryLine[]`. Nothing is required — a game that publishes no totals
  leaves `standings` empty and the card drops the ranking instead of breaking.
- Each game publishes its own conversion next to its view:
  `apps/web/src/games/yatzy/summary.ts` (`summarizeYatzy`) and
  `apps/web/src/games/duel/summary.ts` (`summarizeDuel`). They read the _view_ (the projection), not
  server state, so nothing here can show a client something the projection withheld.
- The registry carries the function: `GameUi.summarize?: (state) => GameSummary | null`, reached
  through `summarizeGame(gameId, state)`. A game that does not implement it (or a game this build
  does not know) returns `null` and no card appears — no route branches on a game id.
- **Ranking happens exactly once, in the platform** (`rankStandings`): the game reports standings in
  its own seat order, and the card sorts them highest first with ties keeping that order. Two viewers
  therefore read the same card, and every game's card is ranked the same way.
- **The card shows only when the game says the game is over.** `summarize*` returns `null` unless the
  view's phase is `finished`, and the table route only asks when `meta.status === "finished"`. A
  finished table with no summary still shows the existing "Game over" notice and Rematch button.
- **One text representation, three consumers.** `summaryTextLines` is the screen-reader copy, the
  clipboard payload, and the layout the PNG draws (`summary-image.ts`). They cannot drift because the
  image is a renderer over the same lines, not a second implementation.
- **The image is drawn in the browser.** No dependency, no server round trip, no stored artifact: a
  `<canvas>` sized 1080×1350, the summary text laid out on it, `toBlob("image/png")`. Where a canvas
  or `toBlob` is unavailable the button is not rendered at all and the text is shown instead — the
  degradation is a visible fallback, not an error.
- **Replay shows the card on the last step only**, built from that step's projection. Every earlier
  step is a board the game had not finished, so the card would be a lie there.

## Consequences

- Adding a game means writing one small function beside the view; the card, the copy button, the
  image and the replay integration come for free (`docs/adding-a-game.md` says so).
- The platform owns presentation, so "what a good ending looks like" can change once for every game.
- `rounds` is deliberately vague: Yatzy counts scored categories, Duel counts played rounds. Each
  game says it in its own unit and the card prints "N rounds" — a shared unit would force a
  conversion nobody needs.
- The card cannot report anything the projection hides, and that is the point: a hidden-information
  game's summary is limited to what the final view shows everyone.
- Chat messages keep the `you`-less spectator projection from
  [ADR 0010](0010-watching-is-a-projection-not-a-mode.md); the summary has the same discipline for
  the same reason.

## Alternatives considered

- **A platform summarizer that reads the board** — rejected: a `gameId` branch in `apps/web/src/ui`,
  which `pnpm check:projection` fails on purpose.
- **Server-assembled summary on the wire** — rejected: a second payload that can disagree with the
  board beside it, and a wire change for a purely presentational concern.
- **A dependency-backed image (satori, html-to-image)** — rejected: a large renderer for one card, and
  it would have to run somewhere with fonts. The canvas version is ~90 lines and has no install cost.
- **Storing the generated PNG** — rejected: an artifact to garbage-collect and a second source of
  truth for a result that is already in the event log.
