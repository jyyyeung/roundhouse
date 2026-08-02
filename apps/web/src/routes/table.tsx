import { Link, useParams, useSearchParams } from "react-router-dom";

export function TablePage() {
  const { tableId = "unknown-table" } = useParams();
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-8">
      <section className="w-full rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(26,26,26,0.14)] backdrop-blur">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[var(--color-coral)]">Table placeholder</p>
        <h1 className="mt-3 font-display text-4xl text-[var(--color-ink)]">{tableId}</h1>
        <p className="mt-3 text-sm text-slate-600">Table UI lands in Task 11. This screen just proves routing and auth are wired.</p>
        {code ? <p className="mt-3 text-sm text-slate-500">Invite code: {code}</p> : null}
        <Link className="mt-5 inline-flex rounded-2xl bg-[var(--color-teal)] px-4 py-3 font-semibold text-[var(--color-ink)]" to="/lobby">
          Back to lobby
        </Link>
      </section>
    </div>
  );
}
