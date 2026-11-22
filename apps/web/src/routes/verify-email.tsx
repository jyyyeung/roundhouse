import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { authClient } from "../lib/auth-client";

type State = { kind: "verifying" } | { kind: "verified" } | { kind: "failed"; message: string };

function getErrorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "This link did not work. Ask for a fresh one from the sign-in page.";
}

/**
 * The landing page for a verification mail.
 *
 * Verification is a spam-folder click, so the page must be unambiguous about
 * whether it worked. The guard exists because React runs effects twice in
 * development: the second call would spend an already-spent token and flip a
 * success into a confusing failure.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>({ kind: "verifying" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "failed", message: "This link is missing its token." });
      return;
    }

    let live = true;
    void authClient
      .verifyEmail({ query: { token } })
      .then((result) => {
        if (!live) return;
        if (result.error) {
          setState({ kind: "failed", message: getErrorMessage(result.error) });
          return;
        }
        setState({ kind: "verified" });
      })
      .catch((error: unknown) => {
        if (live) setState({ kind: "failed", message: getErrorMessage(error) });
      });

    return () => {
      live = false;
    };
  }, [token]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-8">
      <section className="w-full rounded-[2rem] border border-white/70 bg-white/85 p-6 text-center shadow-[0_20px_60px_rgba(26,26,26,0.14)] backdrop-blur">
        <p className="font-display text-5xl leading-none text-[var(--color-ink)]">Roundhouse</p>
        <h1 className="mt-4 text-sm font-semibold uppercase tracking-[0.3em] text-[var(--color-coral)]">
          Email check
        </h1>

        {state.kind === "verifying" ? (
          <p className="mt-4 text-sm text-slate-600" role="status">
            Checking that link...
          </p>
        ) : null}

        {state.kind === "verified" ? (
          <>
            <p
              className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
              role="status"
            >
              That address is yours. You can sit down at any table now.
            </p>
            <Link
              className="mt-6 inline-block w-full rounded-2xl bg-[var(--color-coral)] px-4 py-3 font-semibold text-white shadow-[0_12px_30px_rgba(238,108,77,0.28)]"
              to="/lobby"
            >
              Go to the lobby
            </Link>
          </>
        ) : null}

        {state.kind === "failed" ? (
          <>
            <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {state.message}
            </p>
            <Link
              className="mt-6 inline-block w-full rounded-2xl border border-slate-200 px-4 py-3 font-semibold text-slate-700"
              to="/login"
            >
              Back to sign in
            </Link>
          </>
        ) : null}
      </section>
    </div>
  );
}
