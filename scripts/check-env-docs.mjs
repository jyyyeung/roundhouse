#!/usr/bin/env node
/**
 * Environment documentation guard (issue #47).
 *
 * `apps/server/src/env.ts` is the authoritative list of settings, validated with
 * zod at boot. Nothing forces the operator document to keep up with it, and an
 * undocumented variable is a variable an operator sets wrong — or never learns
 * exists. So the doc is checked, not trusted.
 *
 * The union of variables is read from three places, because three places is
 * where the server actually gets them:
 *
 * - the zod schema in `apps/server/src/env.ts` (validated at boot);
 * - `process.env.X` reads anywhere else in `apps/server/src`, which is how
 *   `LOG_LEVEL` deliberately escapes the schema (the logger must work when the
 *   environment is broken);
 * - the web app's `import.meta.env` reads and the one `env.VITE_*` in
 *   `apps/web/vite.config.ts`, baked in at build time.
 *
 * Run with `pnpm check:env-docs`; CI runs it in `.github/workflows/contracts.yml`
 * next to the projection guard, and `scripts/check-env-docs.test.mjs` proves the
 * checker itself against fixtures rather than only against this repo.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const SERVER_SRC = "apps/server/src";
const ENV_SCHEMA_FILE = `${SERVER_SRC}/env.ts`;
const DOC_FILE = "docs/self-hosting.md";
const EXAMPLE_FILE = ".env.example";
const WEB_SOURCE_DIRS = ["apps/web/src"];
const WEB_CONFIG_FILE = "apps/web/vite.config.ts";

const CODE_FILE = /\.(ts|tsx|mts|cts|js|mjs)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|cts|js|mjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".pi", ".turbo"]);

const NAME = "[A-Z][A-Z0-9_]*";

/** Keys of the object literal passed to `z.object({ ... })` in `env.ts`. */
export function extractSchemaKeys(source) {
  const keys = new Set();
  // `  KEY: z.string()...` — the schema's own indentation, not object literals
  // nested inside a field's default.
  const pattern = new RegExp(`^\\s{2}(${NAME})\\s*:`, "gm");
  for (const match of source.matchAll(pattern)) keys.add(match[1]);
  return keys;
}

/**
 * `process.env.KEY` and `process.env["KEY"]` reads outside the schema.
 *
 * `env.ts` is excluded by the caller: it names every key already. Test helpers
 * are excluded too — a fixture variable is not a deployment setting.
 */
export function extractProcessEnvKeys(sources) {
  const keys = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(new RegExp(`process\\.env\\.(${NAME})\\b`, "g"))) {
      keys.add(match[1]);
    }
    for (const match of source.matchAll(new RegExp(`process\\.env\\[["'](${NAME})["']\\]`, "g"))) {
      keys.add(match[1]);
    }
  }
  return keys;
}

/** `import.meta.env.KEY` in the web app, and `env.KEY` in its vite config. */
export function extractWebEnvKeys(sources) {
  const keys = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(new RegExp(`import\\.meta\\.env\\.(${NAME})`, "g"))) {
      keys.add(match[1]);
    }
    for (const match of source.matchAll(new RegExp(`\\benv\\.(VITE_${NAME})`, "g"))) {
      keys.add(match[1]);
    }
  }
  return keys;
}

/** Variable names documented in `.env.example`, commented out or not. */
export function extractExampleKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(new RegExp(`^\\s*#?\\s*(${NAME})=`, "gm")))
    keys.add(match[1]);
  return keys;
}

/**
 * The document has to name the variable itself, so a row in the reference table
 * (or a `` `PORT` `` in a command) counts and a prose mention of "the port" does
 * not — matching is on the identifier, with word boundaries, so `PORT` does not
 * satisfy `PUBLIC_WEB_URL` and `MAIL_FROM` does not satisfy `MAIL_FROM_EXTRA`.
 */
export function documentsVariable(docText, name) {
  return new RegExp(`\\b${name}\\b`).test(docText);
}

/**
 * The check itself, as a pure function so the test suite can drive it with
 * fixtures instead of the live repo.
 */
export function checkEnvDocs({
  docText,
  exampleText,
  webSource,
  serverSource,
  serverSourceForProcessEnv = [],
}) {
  const variables = new Set([
    ...extractSchemaKeys(serverSource),
    ...extractProcessEnvKeys(serverSourceForProcessEnv),
    ...extractWebEnvKeys(webSource),
  ]);

  const exampleKeys = extractExampleKeys(exampleText);

  const missingFromDoc = [...variables].filter((name) => !documentsVariable(docText, name)).sort();
  const missingFromExample = [...variables].filter((name) => !exampleKeys.has(name)).sort();
  const undocumentedSource = [...exampleKeys].filter((name) => !variables.has(name)).sort();

  return {
    exampleKeys,
    missingFromDoc,
    missingFromExample,
    undocumentedSource,
    variables: [...variables].sort(),
  };
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) yield* walk(path);
    else if (CODE_FILE.test(entry)) yield path;
  }
}

function readServerSources() {
  const schemaFile = join(repoRoot, ENV_SCHEMA_FILE);
  const sources = [];
  for (const file of walk(join(repoRoot, SERVER_SRC))) {
    const path = relative(repoRoot, file).split(sep).join("/");
    if (path === ENV_SCHEMA_FILE) continue;
    if (TEST_FILE.test(path)) continue;
    sources.push({ path, text: readFileSync(file, "utf8") });
  }
  return { schema: readFileSync(schemaFile, "utf8"), sources };
}

function readWebSources() {
  const sources = [];
  for (const dir of WEB_SOURCE_DIRS) {
    for (const file of walk(join(repoRoot, dir))) sources.push(readFileSync(file, "utf8"));
  }
  sources.push(readFileSync(join(repoRoot, WEB_CONFIG_FILE), "utf8"));
  return sources;
}

function main() {
  const server = readServerSources();
  const result = checkEnvDocs({
    docText: readFileSync(join(repoRoot, DOC_FILE), "utf8"),
    exampleText: readFileSync(join(repoRoot, EXAMPLE_FILE), "utf8"),
    serverSource: server.schema,
    serverSourceForProcessEnv: server.sources
      .filter(({ path }) => path.endsWith(".ts"))
      .map(({ text }) => text),
    webSource: readWebSources(),
  });

  const problems = [];

  if (result.missingFromDoc.length > 0) {
    problems.push(
      `${DOC_FILE} does not document: ${result.missingFromDoc.join(", ")}\n` +
        "  Every variable the server or the web app reads belongs in the reference table there.",
    );
  }
  if (result.missingFromExample.length > 0) {
    problems.push(
      `${EXAMPLE_FILE} is missing: ${result.missingFromExample.join(", ")}\n` +
        "  It is the template operators copy, so it has to carry every variable.",
    );
  }
  if (result.undocumentedSource.length > 0) {
    problems.push(
      `${EXAMPLE_FILE} names variables nothing reads: ${result.undocumentedSource.join(", ")}\n` +
        "  A stale setting in the template is worse than a missing one: operators set it and nothing happens.",
    );
  }

  if (problems.length > 0) {
    console.error(`env docs: ${problems.length} problem(s)\n`);
    for (const problem of problems) console.error(`${problem}\n`);
    process.exit(1);
  }

  console.log(
    `env docs: clean (${result.variables.length} variables documented in ${DOC_FILE} and ${EXAMPLE_FILE})`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
