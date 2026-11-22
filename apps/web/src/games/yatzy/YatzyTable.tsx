import type { Json, TableMeta } from "@roundhouse/game-core";
import type { YatzyView } from "@roundhouse/game-yatzy";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TableChatMessage } from "../../lib/chat";
import { feedback } from "../../lib/feedback";
import { avatarFor, avatarStyle, seatLabels } from "../../lib/seats";
import { ChatComposer } from "./ChatComposer";
import { ChatPanel } from "./ChatPanel";
import { DiceTray } from "./DiceTray";
import { totalScore } from "./model";
import { ScoreSheet } from "./ScoreSheet";

type YatzyTableProps = {
  meta: TableMeta;
  state: YatzyView;
  currentUserId: string | null;
  onlineUserIds: string[];
  messages: TableChatMessage[];
  onIntent: (type: string, payload: Json) => void;
  onSendChat: (text: string) => void;
  hasMoreChat: boolean;
  loadingOlderChat: boolean;
  onLoadOlderChat: () => void;
};

/**
 * Counts how often the dice actually changed, so the tray can animate a roll
 * instead of every state update. This is yatzy's reading of its own state: it
 * used to live in the table route, which meant the platform knew what a die was.
 */
function useRollVersion(dice: readonly number[]) {
  const previous = useRef<number[] | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const next = [...dice];
    const prior = previous.current;
    if (prior && prior.length === next.length && next.some((value, at) => value !== prior[at])) {
      setVersion((current) => current + 1);
    }
    previous.current = next;
  }, [dice]);

  return version;
}

/**
 * Sound for the four moments a yatzy turn has. Feedback is a diff of the
 * projected state the tray and the sheet already render, so it needs no new
 * event, no new field, and no knowledge on the server that a phone buzzed.
 *
 * Order matters: a finished game outranks a score (the final score is also a
 * score change), and a score outranks a hold (scoring ends the turn).
 */
function useYatzyFeedback(state: YatzyView) {
  const previous = useRef<YatzyView | null>(null);

  useEffect(() => {
    const prior = previous.current;
    previous.current = state;
    if (!prior) return;

    if (prior.phase !== "finished" && state.phase === "finished") {
      feedback.play("win");
      return;
    }
    if (scoreSignature(prior.sheets) !== scoreSignature(state.sheets)) {
      feedback.play("score");
      return;
    }
    if (prior.holds.some((held, index) => held !== state.holds[index])) {
      feedback.play("hold");
      return;
    }
    if (
      prior.rollsLeft !== state.rollsLeft ||
      prior.dice.some((die, at) => die !== state.dice[at])
    ) {
      feedback.play("roll");
    }
  }, [state]);
}

/** Sheets are small records of numbers; a string compare is enough to notice one. */
function scoreSignature(sheets: YatzyView["sheets"]) {
  return JSON.stringify(sheets);
}

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
  const rollVersion = useRollVersion(props.state.dice);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [statusExpanded, setStatusExpanded] = useState(false);
  const chatDocked = useXlChatDock();
  const chatMode = chatDocked ? "dock" : "overlay";
  const currentPlayerId = props.state.currentPlayerId;
  const isCurrentPlayer = Boolean(props.currentUserId && currentPlayerId === props.currentUserId);

  const playerLabels = useMemo(
    () => seatLabels(props.meta.seatUserIds, props.currentUserId),
    [props.currentUserId, props.meta.seatUserIds],
  );
  useYatzyFeedback(props.state);

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
                  <p className="text-sm font-semibold uppercase tracking-[0.24em] text-white/80">
                    {props.state.ruleset}
                  </p>
                  <div className="mt-2 flex items-center gap-2 md:mt-3">
                    <h1 className="font-display text-2xl leading-none md:text-4xl">
                      {statusHeadline}
                    </h1>
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

              <div
                data-testid="status-details"
                className={[statusExpanded ? "block" : "hidden", "md:block"].join(" ")}
              >
                <p className="mt-3 text-sm text-white/85">{statusHelper}</p>
                <div className="mt-4 flex flex-wrap gap-3 md:mt-5">
                  {props.meta.seatUserIds.map((playerId) => {
                    const online = props.onlineUserIds.includes(playerId);
                    const active = playerId === currentPlayerId;

                    return (
                      <div
                        key={playerId}
                        data-testid={`seat-chip-${playerId}`}
                        className={[
                          "flex items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5 text-sm font-semibold",
                          active ? "bg-white text-[var(--color-ink)]" : "bg-white/15 text-white",
                          active && playerId === props.currentUserId
                            ? "ring-2 ring-[var(--color-ink)]"
                            : "",
                        ].join(" ")}
                      >
                        <span
                          aria-hidden="true"
                          className="flex size-7 items-center justify-center rounded-full text-[0.65rem] font-bold text-white"
                          style={avatarStyle(playerId)}
                        >
                          {avatarFor(playerId).initials}
                        </span>
                        <span className={online ? "text-[var(--color-teal)]" : "opacity-50"}>
                          ●
                        </span>
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
              canRoll={
                isCurrentPlayer && props.state.phase !== "finished" && props.state.rollsLeft > 0
              }
              canToggleHolds={
                isCurrentPlayer &&
                props.state.phase !== "finished" &&
                !props.state.dice.every((die) => die === 0)
              }
              rollVersion={rollVersion}
              onRoll={() => props.onIntent("roll", {})}
              onToggleHold={(index) => {
                const nextHolds = props.state.holds.map((held, heldIndex) =>
                  heldIndex === index ? !held : held,
                );
                props.onIntent("set_holds", { holds: nextHolds });
              }}
            />

            <section
              data-testid="standings"
              className="hidden rounded-[1.5rem] border border-white/70 bg-white/85 p-4 shadow-[0_20px_60px_rgba(26,26,26,0.1)] backdrop-blur md:block"
            >
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--color-coral)]">
                Standings
              </p>
              <div className="mt-3 grid gap-2">
                {props.state.playerIds.map((playerId) => (
                  <motion.div
                    key={playerId}
                    layout
                    className="flex items-center justify-between rounded-2xl bg-[var(--color-cream)] px-3 py-2"
                  >
                    <span className="font-semibold text-[var(--color-ink)]">
                      {playerLabels[playerId] ?? playerId}
                    </span>
                    <span className="font-display text-xl text-[var(--color-ink)]">
                      {totalScore(props.state, playerId)}
                    </span>
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
            hasMoreChat={props.hasMoreChat}
            loadingOlderChat={props.loadingOlderChat}
            onLoadOlderChat={props.onLoadOlderChat}
          />
        </div>
      </div>

      {chatMode === "overlay" && !chatOpen ? (
        <div
          data-testid="chat-float-composer"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-white/60 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(26,26,26,0.12)] backdrop-blur md:hidden"
        >
          <ChatComposer
            variant="float"
            draft={draft}
            onDraftChange={setDraft}
            canSend
            onSend={handleSendChat}
          />
        </div>
      ) : null}
    </>
  );
}
