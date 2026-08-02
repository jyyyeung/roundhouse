import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { YatzyState } from "@roundhouse/game-yatzy";
import type { Json, TableMeta } from "@roundhouse/game-core";

import { ChatComposer } from "./ChatComposer";
import { ChatPanel } from "./ChatPanel";
import { DiceTray } from "./DiceTray";
import { ScoreSheet } from "./ScoreSheet";
import { totalScore, type TableChatMessage } from "./model";

type YatzyTableProps = {
  meta: TableMeta;
  state: YatzyState;
  currentUserId: string | null;
  onlineUserIds: string[];
  messages: TableChatMessage[];
  onIntent: (type: string, payload: Json) => void;
  onSendChat: (text: string) => void;
  rollVersion: number;
};

function useXlChatDock() {
  const [dock, setDock] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(min-width: 1280px)").matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(min-width: 1280px)");
    const onChange = () => setDock(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return dock;
}

export function YatzyTable(props: YatzyTableProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [statusExpanded, setStatusExpanded] = useState(false);
  const chatDocked = useXlChatDock();
  const chatMode = chatDocked ? "dock" : "overlay";
  const currentPlayerId = props.state.playerIds[props.state.currentPlayerIndex] ?? null;
  const isCurrentPlayer = Boolean(props.currentUserId && currentPlayerId === props.currentUserId);

  const playerLabels = useMemo(() => {
    return Object.fromEntries(
      props.meta.seatUserIds.map((playerId, index) => [
        playerId,
        playerId === props.currentUserId ? "You" : `Player ${index + 1}`,
      ]),
    ) as Record<string, string>;
  }, [props.currentUserId, props.meta.seatUserIds]);

  const statusHeadline =
    props.state.phase === "finished"
      ? "Final scores"
      : `${playerLabels[currentPlayerId ?? ""] ?? "Next up"} to roll`;

  const statusHelper =
    props.state.phase === "finished"
      ? `Winner: ${props.state.winnerIds.map((playerId) => playerLabels[playerId] ?? playerId).join(", ")}`
      : isCurrentPlayer
        ? "Your turn. Roll, hold, then lock in a category."
        : "Watch the dice, then pounce when your turn swings back.";

  function handleSendChat(text: string) {
    props.onSendChat(text);
    setDraft("");
  }

  return (
    <>
      <div className="yatzy-chat-shell mt-0 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:items-start xl:gap-5">
        <div className="yatzy-board grid gap-5 md:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] md:items-start">
          <div className="flex min-w-0 flex-col gap-5">
            <section className="rounded-[2rem] bg-[linear-gradient(135deg,var(--color-coral),var(--color-mango))] p-4 text-white shadow-[0_20px_50px_rgba(238,108,77,0.32)] md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold uppercase tracking-[0.24em] text-white/80">{props.state.ruleset}</p>
                  <div className="mt-2 flex items-center gap-2 md:mt-3">
                    <h1 className="font-display text-2xl leading-none md:text-4xl">{statusHeadline}</h1>
                    <button
                      type="button"
                      className="rounded-xl bg-white/20 px-2 py-1 text-xs font-semibold text-white backdrop-blur md:hidden"
                      aria-expanded={statusExpanded}
                      aria-label={statusExpanded ? "Collapse status" : "Expand status"}
                      onClick={() => setStatusExpanded((open) => !open)}
                    >
                      {statusExpanded ? "▴" : "▾"}
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-2xl bg-white/20 px-4 py-3 text-sm font-semibold text-white backdrop-blur xl:hidden"
                  onClick={() => setChatOpen(true)}
                >
                  Chat
                </button>
              </div>

              <div data-testid="status-details" className={[statusExpanded ? "block" : "hidden", "md:block"].join(" ")}>
                <p className="mt-3 text-sm text-white/85">{statusHelper}</p>
                <div className="mt-4 flex flex-wrap gap-3 md:mt-5">
                  {props.meta.seatUserIds.map((playerId) => {
                    const online = props.onlineUserIds.includes(playerId);
                    const active = playerId === currentPlayerId;

                    return (
                      <div
                        key={playerId}
                        className={[
                          "rounded-full px-4 py-2 text-sm font-semibold",
                          active ? "bg-white text-[var(--color-ink)]" : "bg-white/15 text-white",
                        ].join(" ")}
                      >
                        <span className={online ? "text-[var(--color-teal)]" : "text-white/40"}>●</span>{" "}
                        {playerLabels[playerId] ?? playerId}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <DiceTray
              dice={props.state.dice}
              holds={props.state.holds}
              rollsLeft={props.state.rollsLeft}
              canRoll={isCurrentPlayer && props.state.phase !== "finished" && props.state.rollsLeft > 0}
              canToggleHolds={isCurrentPlayer && props.state.phase !== "finished" && !props.state.dice.every((die) => die === 0)}
              rollVersion={props.rollVersion}
              onRoll={() => props.onIntent("roll", {})}
              onToggleHold={(index) => {
                const nextHolds = props.state.holds.map((held, heldIndex) => (heldIndex === index ? !held : held));
                props.onIntent("set_holds", { holds: nextHolds });
              }}
            />

            <section
              data-testid="standings"
              className="hidden rounded-[1.5rem] border border-white/70 bg-white/85 p-4 shadow-[0_20px_60px_rgba(26,26,26,0.1)] backdrop-blur md:block"
            >
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--color-coral)]">Standings</p>
              <div className="mt-3 grid gap-2">
                {props.state.playerIds.map((playerId) => (
                  <motion.div
                    key={playerId}
                    layout
                    className="flex items-center justify-between rounded-2xl bg-[var(--color-cream)] px-3 py-2"
                  >
                    <span className="font-semibold text-[var(--color-ink)]">{playerLabels[playerId] ?? playerId}</span>
                    <span className="font-display text-xl text-[var(--color-ink)]">{totalScore(props.state, playerId)}</span>
                  </motion.div>
                ))}
              </div>
            </section>
          </div>

          <div className="min-h-0 min-w-0 md:sticky md:top-4 md:h-[calc(100dvh-6rem)]">
            <ScoreSheet
              state={props.state}
              playerLabels={playerLabels}
              currentUserId={props.currentUserId}
              canScore={isCurrentPlayer && props.state.phase !== "finished"}
              onScore={(category) => props.onIntent("score", { category })}
            />
          </div>
        </div>

        <div className={chatMode === "dock" ? "min-h-0 xl:h-[calc(100dvh-6rem)]" : "min-h-0"}>
          <ChatPanel
            mode={chatMode}
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            messages={props.messages}
            playerLabels={playerLabels}
            canSend
            onSend={handleSendChat}
            draft={draft}
            onDraftChange={setDraft}
          />
        </div>
      </div>

      {chatMode === "overlay" && !chatOpen ? (
        <div
          data-testid="chat-float-composer"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-white/60 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(26,26,26,0.12)] backdrop-blur md:hidden"
        >
          <ChatComposer variant="float" draft={draft} onDraftChange={setDraft} canSend onSend={handleSendChat} />
        </div>
      ) : null}
    </>
  );
}
