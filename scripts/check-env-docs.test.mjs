#!/usr/bin/env node
/**
 * Tests for the environment documentation guard.
 *
 * The guard is the thing that keeps `docs/self-hosting.md` true, so it gets the
 * same treatment as production code: fixtures, not just "it passed on today's
 * repo". Run with `node --test scripts/check-env-docs.test.mjs` (or
 * `pnpm test:scripts`), which needs no install step — CI runs it beside the
 * guard for exactly that reason.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkEnvDocs,
  documentsVariable,
  extractExampleKeys,
  extractProcessEnvKeys,
  extractSchemaKeys,
  extractWebEnvKeys,
} from "./check-env-docs.mjs";

const schema = `
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3001),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});
`;

test("reads the keys of the zod schema, including ones split across lines", () => {
  assert.deepEqual([...extractSchemaKeys(schema)].sort(), ["DATABASE_URL", "PORT", "TRUST_PROXY"]);
});

test("ignores nested object literals and comments", () => {
  const nested = `
const envSchema = z.object({
  MAIL: z.object({
    HOST: z.string(),
  }).optional(),
});
`;
  assert.deepEqual([...extractSchemaKeys(nested)], ["MAIL"]);
});

test("finds process.env reads in both bracket and dot form", () => {
  const sources = [
    `const level = process.env.LOG_LEVEL;`,
    `const x = process.env["DATABASE_URL"];`,
  ];
  assert.deepEqual([...extractProcessEnvKeys(sources)].sort(), ["DATABASE_URL", "LOG_LEVEL"]);
});

test("finds web env reads and the vite config's own env.KEY", () => {
  const sources = [
    `const url = import.meta.env.VITE_API_URL || window.location.origin;`,
    `const apiUrl = env.VITE_API_URL || "http://localhost:3001";`,
  ];
  assert.deepEqual([...extractWebEnvKeys(sources)], ["VITE_API_URL"]);
});

test("reads .env.example names whether or not the line is commented out", () => {
  const example = ["DATABASE_URL=x", "# GOOGLE_CLIENT_ID=", "", "PORT=3001"].join("\n");
  assert.deepEqual([...extractExampleKeys(example)].sort(), [
    "DATABASE_URL",
    "GOOGLE_CLIENT_ID",
    "PORT",
  ]);
});

test("matches a variable name only on a word boundary", () => {
  assert.equal(documentsVariable("| `PORT` | 3001 |", "PORT"), true);
  assert.equal(documentsVariable("the port is 3001", "PORT"), false);
  assert.equal(documentsVariable("MAIL_FROM_EXTRA=x", "MAIL_FROM"), false);
});

test("a documented, template-covered variable set is clean", () => {
  const result = checkEnvDocs({
    docText:
      "| `DATABASE_URL` | x |\n| `PORT` | 3001 |\n| `TRUST_PROXY` | off |\n| `LOG_LEVEL` | info |\n",
    exampleText: "DATABASE_URL=\nPORT=\nTRUST_PROXY=\nLOG_LEVEL=\n",
    serverSource: schema,
    serverSourceForProcessEnv: ["process.env.LOG_LEVEL"],
    webSource: [],
  });
  assert.deepEqual(result.missingFromDoc, []);
  assert.deepEqual(result.missingFromExample, []);
  assert.deepEqual(result.undocumentedSource, []);
});

test("names the variable missing from the document", () => {
  const result = checkEnvDocs({
    docText: "| `DATABASE_URL` | x |\n| `PORT` | 3001 |\n",
    exampleText: "DATABASE_URL=\nPORT=\nTRUST_PROXY=\n",
    serverSource: schema,
    webSource: [],
  });
  assert.deepEqual(result.missingFromDoc, ["TRUST_PROXY"]);
  assert.deepEqual(result.missingFromExample, []);
});

test("names the variable missing from the template", () => {
  const result = checkEnvDocs({
    docText: "| `DATABASE_URL` | x |\n| `PORT` | 3001 |\n| `TRUST_PROXY` | off |\n",
    exampleText: "DATABASE_URL=\nPORT=\n",
    serverSource: schema,
    webSource: [],
  });
  assert.deepEqual(result.missingFromExample, ["TRUST_PROXY"]);
});

test("flags a template setting nothing reads", () => {
  const result = checkEnvDocs({
    docText: "| `DATABASE_URL` | x |\n| `PORT` | 3001 |\n| `TRUST_PROXY` | off |\n",
    exampleText: "DATABASE_URL=\nPORT=\nTRUST_PROXY=\nSHINY_NEW_THING=on\n",
    serverSource: schema,
    webSource: [],
  });
  assert.deepEqual(result.undocumentedSource, ["SHINY_NEW_THING"]);
});

test("covers the web app's build-time variables too", () => {
  const result = checkEnvDocs({
    docText: "| `DATABASE_URL` | x |\n| `PORT` | 3001 |\n| `TRUST_PROXY` | off |\n",
    exampleText: "DATABASE_URL=\nPORT=\nTRUST_PROXY=\n",
    serverSource: schema,
    webSource: ["const url = import.meta.env.VITE_API_URL || window.location.origin;"],
  });
  assert.deepEqual(result.missingFromDoc, ["VITE_API_URL"]);
  assert.deepEqual(result.missingFromExample, ["VITE_API_URL"]);
});
