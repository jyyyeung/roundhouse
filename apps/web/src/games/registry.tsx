import type { Json, TableMeta } from "@roundhouse/game-core";
import type { DuelView } from "@roundhouse/game-duel";
import type { YatzyView } from "@roundhouse/game-yatzy";
import type { ComponentType } from "react";
import type { TableChatMessage } from "../lib/chat";
import type { GameSummary } from "../lib/summary";
import { DuelTable } from "./duel/DuelTable";
import { summarizeDuel } from "./duel/summary";
import { summarizeYatzy } from "./yatzy/summary";
import { YatzyConfigControls, yatzyTableTitle } from "./yatzy/YatzyConfigControls";
import { YatzyTable } from "./yatzy/YatzyTable";

/**
 * What every game view receives. Nothing here is specific to a game: chat,
 * presence and the room meta are platform features, and `state` is whatever that
 * game's projection published (validation is the game's job, not this file's).
 */
export type GameViewProps = {
  meta: TableMeta;
  state: unknown;
  currentUserId: string | null;
  onlineUserIds: string[];
  messages: TableChatMessage[];
  onIntent: (type: string, payload: Json) => void;
  onSendChat: (text: string) => void;
  hasMoreChat: boolean;
  loadingOlderChat: boolean;
  onLoadOlderChat: () => void;
  /**
   * Replay renders a board that already happened. A view must not offer an
   * action it cannot deliver, so every control is off when this is set.
   */
  readOnly?: boolean;
};

/** The per-game half of the create-table form, rendered by the lobby. */
export type GameConfigControlsProps = {
  config: Json;
  onChange: (config: Json) => void;
};

export type GameUi = {
  View: ComponentType<GameViewProps>;
  /** Absent when the game has nothing to configure. */
  ConfigControls?: ComponentType<GameConfigControlsProps>;
  /** How a table of this game is named in the lobby list; defaults to the catalogue name. */
  tableTitle?: (config: Json | undefined) => string;
  /**
   * How this game says its finished board: who won, what everyone scored, and
   * anything sharper it can add. Absent when the game has nothing to say beyond
   * the board itself, in which case no summary card is shown.
   */
  summarize?: (state: unknown) => GameSummary | null;
};

/**
 * The browser's half of game registration. Adding a game adds one entry here and
 * one in `apps/server/src/modules/registry.ts`; nothing in `routes/` changes.
 */
/**
 * The one place a game's view is bound to the shared props. `state` arrives as
 * `unknown` because the platform does not parse game state; the cast is the
 * game's declaration that this table's projection is a `YatzyView`.
 */
function YatzyViewForTable(props: GameViewProps) {
  return <YatzyTable {...props} state={props.state as YatzyView} />;
}

/**
 * Duel's view takes only the props it uses: it has no chat panel and nothing to
 * configure, so `GameViewProps` is narrowed by the component's own signature.
 */
function DuelViewForTable(props: GameViewProps) {
  return (
    <DuelTable
      state={props.state as DuelView}
      meta={props.meta}
      currentUserId={props.currentUserId}
      onlineUserIds={props.onlineUserIds}
      onIntent={props.onIntent}
      readOnly={props.readOnly}
    />
  );
}

const gameUi: Record<string, GameUi> = {
  duel: {
    summarize: (state) => summarizeDuel(state as DuelView),
    View: DuelViewForTable,
  },
  yatzy: {
    ConfigControls: YatzyConfigControls,
    summarize: (state) => summarizeYatzy(state as YatzyView),
    View: YatzyViewForTable,
    tableTitle: yatzyTableTitle,
  },
};

export function getGameUi(gameId: string): GameUi | undefined {
  return gameUi[gameId];
}

export function renderGameView(props: GameViewProps) {
  const entry = getGameUi(props.meta.gameId);
  if (entry) return <entry.View {...props} />;

  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur">
      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--color-coral)]">
        Unsupported game
      </p>
      <h2 className="mt-3 font-display text-3xl text-[var(--color-ink)]">{props.meta.gameId}</h2>
      <p className="mt-2 text-sm text-slate-600">
        This table is running a game this build does not know how to show.
      </p>
    </section>
  );
}

/**
 * A table's display name: the game's own reading of its config, else the name
 * the catalogue gave it, else the raw id. Used by the lobby list and the table
 * header, so neither has to know what a ruleset is.
 */
export function tableTitleFor(gameId: string, config: Json | undefined, fallback?: string): string {
  return getGameUi(gameId)?.tableTitle?.(config) ?? fallback ?? gameId;
}

/**
 * The finished game's summary, or null when the game has none to give — which is
 * also what a game this build does not know about answers. Callers render the
 * card only when this returns something, so no route branches per game.
 */
export function summarizeGame(gameId: string, state: unknown): GameSummary | null {
  return getGameUi(gameId)?.summarize?.(state) ?? null;
}
