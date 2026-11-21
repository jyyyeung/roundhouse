import type { FormEvent } from "react";

export type ChatComposerProps = {
  draft: string;
  onDraftChange: (value: string) => void;
  canSend: boolean;
  onSend: (text: string) => void;
  variant: "panel" | "float";
};

export function ChatComposer(props: ChatComposerProps) {
  const trimmed = props.draft.trim();
  const disabled = !props.canSend || trimmed.length === 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTrimmed = props.draft.trim();
    const nextDisabled = !props.canSend || nextTrimmed.length === 0;
    if (nextDisabled) return;
    props.onSend(nextTrimmed);
  }

  if (props.variant === "float") {
    return (
      <form className="flex items-center gap-2" onSubmit={handleSubmit}>
        <input
          type="text"
          className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-coral)]"
          placeholder="Call your shot..."
          aria-label="Message"
          value={props.draft}
          onChange={(event) => props.onDraftChange(event.target.value)}
          maxLength={500}
          disabled={!props.canSend}
        />
        <button
          type="submit"
          className="shrink-0 rounded-2xl bg-[var(--color-coral)] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          aria-label="Send message"
        >
          Send
        </button>
      </form>
    );
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <textarea
        className="min-h-28 w-full resize-none rounded-[1.5rem] border border-slate-200 bg-white px-4 py-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-coral)]"
        placeholder="Call your shot..."
        aria-label="Message"
        value={props.draft}
        onChange={(event) => props.onDraftChange(event.target.value)}
        maxLength={500}
        disabled={!props.canSend}
      />
      <button
        type="submit"
        className="w-full rounded-2xl bg-[var(--color-coral)] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
      >
        Send message
      </button>
    </form>
  );
}
