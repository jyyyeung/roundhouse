import { AnimatePresence, motion } from "motion/react";

import { ChatComposer } from "./ChatComposer";
import { ChatDiceChips } from "./ChatDiceChips";
import { readChatSnapshot, type TableChatMessage } from "./model";

export type ChatPanelProps = {
  mode: "dock" | "overlay";
  open: boolean;
  onClose: () => void;
  messages: TableChatMessage[];
  playerLabels: Record<string, string>;
  canSend: boolean;
  onSend: (text: string) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  hasMoreChat: boolean;
  loadingOlderChat: boolean;
  onLoadOlderChat: () => void;
};

type MessageListProps = Pick<
  ChatPanelProps,
  "messages" | "playerLabels" | "hasMoreChat" | "loadingOlderChat" | "onLoadOlderChat"
>;

function MessageList(props: MessageListProps) {
  return (
    <div className="mt-5 flex-1 space-y-3 overflow-y-auto pr-1">
      {props.hasMoreChat ? (
        <button
          type="button"
          className="w-full rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-60"
          onClick={props.onLoadOlderChat}
          disabled={props.loadingOlderChat}
        >
          {props.loadingOlderChat ? "Loading…" : "Load earlier messages"}
        </button>
      ) : null}
      {props.messages.length === 0 ? (
        <p className="text-sm text-slate-500">No chat yet. Start the table banter.</p>
      ) : null}
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
    </div>
  );
}

export function ChatPanel(props: ChatPanelProps) {
  const composer = (
    <div className="mt-5">
      <ChatComposer
        variant="panel"
        draft={props.draft}
        onDraftChange={props.onDraftChange}
        canSend={props.canSend}
        onSend={props.onSend}
      />
    </div>
  );

  if (props.mode === "dock") {
    return (
      <aside
        data-testid="chat-panel"
        className="flex h-full min-h-0 w-full flex-col border border-white/60 bg-white/96 p-5 shadow-[0_20px_60px_rgba(26,26,26,0.1)] backdrop-blur xl:rounded-[2rem]"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--color-coral)]">Chat</p>
            <p className="mt-1 text-sm text-slate-500">Dice talk stays in the room.</p>
          </div>
        </div>
        <MessageList
          messages={props.messages}
          playerLabels={props.playerLabels}
          hasMoreChat={props.hasMoreChat}
          loadingOlderChat={props.loadingOlderChat}
          onLoadOlderChat={props.onLoadOlderChat}
        />
        {composer}
      </aside>
    );
  }

  return (
    <AnimatePresence>
      {props.open ? (
        <>
          <motion.button
            type="button"
            className="fixed inset-0 z-30 bg-slate-950/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={props.onClose}
            aria-label="Close chat"
          />
          <motion.aside
            data-testid="chat-panel"
            className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-white/60 bg-white/96 p-5 shadow-[-20px_0_60px_rgba(26,26,26,0.18)] backdrop-blur"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--color-coral)]">Chat</p>
                <p className="mt-1 text-sm text-slate-500">Dice talk stays in the room.</p>
              </div>
              <button
                type="button"
                className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700"
                onClick={props.onClose}
              >
                Close
              </button>
            </div>
            <MessageList
          messages={props.messages}
          playerLabels={props.playerLabels}
          hasMoreChat={props.hasMoreChat}
          loadingOlderChat={props.loadingOlderChat}
          onLoadOlderChat={props.onLoadOlderChat}
        />
            {composer}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
