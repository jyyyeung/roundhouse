#!/usr/bin/env node
/**
 * Projection guard (ADR 0001, invariant I1).
 *
 * One contract, checked mechanically so a refactor cannot quietly break it:
 * stored module state becomes a client-visible payload in exactly one place,
 * `apps/server/src/room/projection.ts`, and the web app never learns the shape
 * of that stored state.
 *
 * Run with `pnpm check:projection`; CI runs it in `.github/workflows/contracts.yml`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const SEAM = "apps/server/src/room/projection.ts";
const CODE_FILE = /\.(ts|tsx|mts|cts|js|mjs)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|cts|js|mjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".pi", ".turbo"]);

// Every game the server ships, read from disk so the guard keeps working when a
// second title lands. Naming one of these in platform code means the platform
// still has a branch per game.
const GAME_IDS = readdirSync(join(repoRoot, "packages/games")).filter((entry) =>
  statSync(join(repoRoot, "packages/games", entry)).isDirectory(),
);

const rules = [
  {
    allow: [SEAM],
    dirs: ["apps/server/src"],
    id: "single-seam",
    message:
      "module.projectStateFor may only be called from apps/server/src/room/projection.ts; " +
      "everything else asks the runtime or the hub for a projection (or calls projectSnapshot).",
    pattern: /\.projectStateFor\s*\(/,
  },
  {
    allow: [SEAM],
    dirs: ["apps/server/src"],
    id: "no-raw-state-cast",
    message:
      "the cast from the jsonb column to RawGameState lives next to the projection; " +
      "use rawGameState() from ./projection instead of casting.",
    pattern: /\bas\s+RawGameState\b/,
  },
  {
    allow: [SEAM, "apps/server/src/room/runtime.ts"],
    dirs: ["apps/server/src"],
    id: "one-state-source",
    message:
      "rawGameState() may only be called by the projection seam and the room runtime that " +
      "owns the table row; anything else receives state already projected for a viewer.",
    pattern: /\brawGameState\s*\(/,
  },
  {
    allow: [],
    allFiles: true,
    dirs: ["apps/web/src"],
    id: "client-sees-only-the-view",
    message:
      "the web app may only name the public view type (e.g. YatzyView). Naming stored state, " +
      "a GameModule or the projection function means a hidden field could reach the client.",
    pattern: /\b(RawGameState|YatzyState|GameModule|projectStateFor|getPublicSnapshot)\b/,
  },
  {
    // Game folders own their own id; anywhere else it is a branch in disguise.
    allowPrefixes: ["apps/server/src/modules/", "apps/web/src/games/"],
    dirs: ["apps/server/src", "apps/web/src"],
    id: "no-game-branch",
    message:
      "platform code may not name a specific game. Put the game in its module (packages/games/*) " +
      "and reach it through a registry entry, so adding a game needs no change here.",
    pattern: new RegExp(`["'\`](${GAME_IDS.join("|")})["'\`]`),
  },
  {
    allow: [],
    allFiles: true,
    dirs: ["apps/server/src", "apps/web/src", "packages"],
    id: "retired-api",
    message:
      "getPublicSnapshot was retired in M0-2: it shipped raw module state. Use projectStateFor " +
      "behind projectSnapshot.",
    pattern: /\bgetPublicSnapshot\b/,
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) yield* walk(path);
    else if (CODE_FILE.test(entry)) yield path;
  }
}

const toRepoPath = (path) => relative(repoRoot, path).split(sep).join("/");
const isComment = (line) => /^\s*(\/\/|\/?\*)/.test(line);

const violations = [];
let filesChecked = 0;

for (const rule of rules) {
  for (const dir of rule.dirs) {
    let files;
    try {
      files = walk(join(repoRoot, dir));
    } catch {
      continue; // a directory the rule names may not exist in a trimmed checkout
    }

    for (const file of files) {
      const path = toRepoPath(file);
      if (rule.allow?.includes(path)) continue;
      if (rule.allowPrefixes?.some((prefix) => path.startsWith(prefix))) continue;
      if (!rule.allFiles && TEST_FILE.test(path)) continue;

      filesChecked += 1;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (isComment(line)) return;
        if (!rule.pattern.test(line)) return;
        violations.push({ line, path, rule, lineNumber: index + 1 });
      });
    }
  }
}

if (violations.length > 0) {
  console.error(`projection guard: ${violations.length} violation(s)\n`);
  for (const { line, lineNumber, path, rule } of violations) {
    console.error(`${path}:${lineNumber}  [${rule.id}]`);
    console.error(`  ${line.trim()}`);
    console.error(`  ${rule.message}\n`);
  }
  process.exit(1);
}

console.log(
  `projection guard: clean (${rules.length} rules, ${filesChecked} file checks, seam ${SEAM})`,
);
