/**
 * Waits until a URL answers with a 2xx, then exits. Fails loudly on timeout.
 *
 * Used by scripts/compose-smoke.sh and by CI to turn "the container is up but the
 * app inside it is not" into a readable failure instead of a hang.
 *
 * Usage:
 *   node scripts/wait-for-url.mjs <url> [name] [--expect <substring>] [--timeout <ms>]
 *
 * --expect asserts the body contains the substring, which is how the web root is
 * checked: a 200 from nginx proves nothing if it is serving the default page.
 */
const args = process.argv.slice(2);
const url = args.shift();
if (!url) {
  console.error(
    "usage: node scripts/wait-for-url.mjs <url> [name] [--expect <text>] [--timeout <ms>]",
  );
  process.exit(2);
}

let name = url;
if (args[0] && !args[0].startsWith("--")) name = args.shift();

let expect;
let timeoutMs = 120_000;
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (flag === "--expect" && value !== undefined) expect = value;
  else if (flag === "--timeout" && value !== undefined) timeoutMs = Number(value);
  else {
    console.error(`unknown argument: ${flag}`);
    process.exit(2);
  }
}

const deadline = Date.now() + timeoutMs;
let lastError = "no attempt made";

while (Date.now() < deadline) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      const body = expect === undefined ? "" : await response.text();
      if (expect === undefined || body.includes(expect)) {
        console.log(`ok    ${name} (${response.status})`);
        process.exit(0);
      }
      lastError = `status ${response.status}, body does not contain ${JSON.stringify(expect)}`;
    } else {
      lastError = `status ${response.status}`;
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.error(`FAIL  ${name} at ${url} after ${timeoutMs}ms — ${lastError}`);
process.exit(1);
