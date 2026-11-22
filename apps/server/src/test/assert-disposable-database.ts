/**
 * Truncating the wrong database would delete a developer's games, so the name
 * must say what it is. A misconfigured run fails loudly instead of skipping.
 */
export function assertDisposableDatabase(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(
      `DATABASE_URL_TEST must point at a database whose name ends in _test (got "${name}"). ` +
        "This suite truncates every table between tests.",
    );
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL_TEST must not be the same database as DATABASE_URL.");
  }
}
