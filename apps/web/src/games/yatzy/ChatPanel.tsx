import { type FormEvent, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { readChatSnapshot, type TableChatMessage } from "./model";

type ChatPanelProps = {
  open: boolean;
  onClose: () => void;
  messages: TableChatMessage[];
  playerLabels: Record<string, string>;
  canSend: boolean;
  onSend: (text: string) => void;
};

export function ChatPanel(props: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    props.onSend(text);
    setDraft("");
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

            <div className="mt-5 flex-1 space-y-3 overflow-y-auto pr-1">
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
                    <p className="mt-2 text-sm leading-6 text-slate-700">{message.text}</p>
                    {snapshot.dice.length > 0 ? (
                      <div className="mt-3 rounded-2xl bg-white/80 px-3 py-2 text-xs text-slate-600">
                        <p className="font-semibold uppercase tracking-[0.16em] text-[var(--color-coral)]">Snapshot</p>
                        <p className="mt-1 font-display text-lg tracking-[0.24em] text-[var(--color-ink)]">{snapshot.dice.join("")}</p>
                        <p className="mt-1">
                          Holds:{" "}
                          {snapshot.holds.length > 0
                            ? snapshot.holds.map((held) => (held ? "H" : "-")).join("")
                            : "-----"}
                        </p>
                        <p className="mt-1">
                          {snapshot.rollsLeft === 1 ? "1 roll left" : `${snapshot.rollsLeft ?? 0} rolls left`}
                        </p>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>

            <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
              <textarea
                className="min-h-28 w-full resize-none rounded-[1.5rem] border border-slate-200 bg-white px-4 py-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-coral)]"
                placeholder="Call your shot..."
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={500}
                disabled={!props.canSend}
              />
              <button
                type="submit"
                className="w-full rounded-2xl bg-[var(--color-coral)] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!props.canSend || draft.trim().length === 0}
              >
                Send message
              </button>
            </form>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
