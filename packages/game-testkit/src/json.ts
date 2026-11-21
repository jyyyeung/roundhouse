import type { Json } from "@roundhouse/game-core";

/**
 * Everything the conformance suite asserts about a projection or a stored state
 * rests on one claim: it is JSON. `JSON.parse(JSON.stringify(x))` is the check
 * that actually matters, because that is what the wire and the jsonb columns do
 * to it, but it silently drops `undefined`, turns a `Date` into a string, and
 * throws on a `BigInt` or a cycle. So the type walk comes first and names the
 * offending path, and the round trip comes second.
 */

const JSON_PRIMITIVES = new Set(["boolean", "string"]);

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") {
    const name = value.constructor?.name;
    return name ? `${name} instance` : "object with an unusual prototype";
  }
  return typeof value;
}

function walk(value: unknown, path: string, seen: WeakSet<object>): void {
  if (value === null || JSON_PRIMITIVES.has(typeof value)) return;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} is ${String(value)}, which JSON cannot represent`);
    }
    return;
  }

  if (typeof value !== "object") {
    throw new Error(
      `${path} is ${describeValue(value)} (${typeof value}), which JSON cannot represent`,
    );
  }

  if (seen.has(value)) {
    throw new Error(`${path} is a cycle`);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      walk(item, `${path}[${index}]`, seen);
    }
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} is a ${describeValue(value)}, not a plain object`);
  }

  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.length > 0) {
    throw new Error(`${path} has symbol keys, which JSON silently drops`);
  }

  for (const [key, item] of Object.entries(value)) {
    walk(item, `${path}.${key}`, seen);
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }

  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      Object.hasOwn(right, key) &&
      deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}

/**
 * Returns `value` typed as `Json`, or throws naming the first path that could not
 * survive the wire. `label` prefixes every message so a failure says which frame
 * or state it came from.
 */
export function assertJsonSafe(value: unknown, label: string): Json {
  walk(value, label, new WeakSet<object>());

  const roundTripped: unknown = JSON.parse(JSON.stringify(value));
  if (!deepEqual(roundTripped, value)) {
    throw new Error(`${label} changes when serialised: JSON drops or rewrites part of it`);
  }

  return value as Json;
}

/** Recursively freezes a JSON value, so a mutation at any depth throws. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;

  Object.freeze(value);
  for (const item of Object.values(value)) {
    deepFreeze(item);
  }
  return value;
}

/** Snapshot for "did this call mutate its input" assertions. */
export function serialize(value: unknown): string {
  return JSON.stringify(value);
}
