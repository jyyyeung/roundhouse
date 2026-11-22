import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { authClient } from "../lib/auth-client";

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
  return "That did not work. Try again.";
}

const fieldClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none ring-0 transition focus:border-[var(--color-coral)]";
const labelClass = "mb-2 block text-sm font-semibold text-slate-700";

/**
 * The landing page for a reset mail.
 *
 * The token is spent here, against the API, and only then does the page move on
 * to sign-in: a browser that reloads this link twice must see the "this link is
 * used" answer rather than a stale form.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setPending(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(getErrorMessage(result.error));
        return;
      }
      navigate("/login", {
        replace: true,
        state: { notice: "Password updated. Sign in with the new one." },
      });
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-8">
      <section className="w-full rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(26,26,26,0.14)] backdrop-blur">
        <p className="font-display text-5xl leading-none text-[var(--color-ink)]">Roundhouse</p>
        <h1 className="mt-4 text-sm font-semibold uppercase tracking-[0.3em] text-[var(--color-coral)]">
          New password
        </h1>

        {token ? (
          <>
            <p className="mt-3 text-sm text-slate-600">
              Pick something you have not used here before. The link stops working once you submit.
            </p>
            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <label className="block">
                <span className={labelClass}>New password</span>
                <input
                  className={fieldClass}
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              <label className="block">
                <span className={labelClass}>Repeat it</span>
                <input
                  className={fieldClass}
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                />
              </label>

              {error ? (
                <p
                  className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                className="w-full rounded-2xl bg-[var(--color-coral)] px-4 py-3 font-semibold text-white shadow-[0_12px_30px_rgba(238,108,77,0.28)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-70"
                disabled={pending}
              >
                {pending ? "Saving..." : "Save and sign in"}
              </button>
            </form>
          </>
        ) : (
          <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            This link is missing its token. Ask for a fresh reset mail from the sign-in page.
          </p>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          <Link className="font-semibold text-[var(--color-coral)]" to="/login">
            Back to sign in
          </Link>
        </p>
      </section>
    </div>
  );
}
