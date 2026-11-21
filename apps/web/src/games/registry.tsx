import type { Json, TableMeta } from "@roundhouse/game-core";
import type { YatzyView } from "@roundhouse/game-yatzy";

import { YatzyTable } from "./yatzy/YatzyTable";
import type { TableChatMessage } from "./yatzy/model";

type GameViewProps = {
  meta: TableMeta;
  state: unknown;
  currentUserId: string | null;
  onlineUserIds: string[];
  messages: TableChatMessage[];
  onIntent: (type: string, payload: Json) => void;
  onSendChat: (text: string) => void;
  rollVersion: number;
  hasMoreChat: boolean;
  loadingOlderChat: boolean;
  onLoadOlderChat: () => void;
};

export function renderGameView(props: GameViewProps) {
  if (props.meta.gameId === "yatzy") {
    return (
      <YatzyTable
        meta={props.meta}
        state={props.state as YatzyView}
        currentUserId={props.currentUserId}
        onlineUserIds={props.onlineUserIds}
        messages={props.messages}
        onIntent={props.onIntent}
        onSendChat={props.onSendChat}
        rollVersion={props.rollVersion}
        hasMoreChat={props.hasMoreChat}
        loadingOlderChat={props.loadingOlderChat}
        onLoadOlderChat={props.onLoadOlderChat}
      />
    );
  }

  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(26,26,26,0.12)] backdrop-blur">
      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--color-coral)]">Unsupported game</p>
      <h2 className="mt-3 font-display text-3xl text-[var(--color-ink)]">{props.meta.gameId}</h2>
    </section>
  );
}
