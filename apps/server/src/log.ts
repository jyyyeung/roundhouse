/**
 * One JSON logger for the server.
 *
 * Two rules keep it honest:
 *
 * - **It never reads `./env`.** Logging has to work when the environment is
 *   broken — a missing `DATABASE_URL` is exactly when you want a log line — so
 *   the level comes straight from `process.env.LOG_LEVEL` and an unparseable
 *   value falls back to `info` instead of throwing.
 * - **Nothing user-supplied is logged by default.** Callers pass identifiers
 *   (`tableId`, `actionId`, `userId`, `code`) and durations. Chat text, intent
 *   payloads and game state stay out: they are the user's data, and a debug log
 *   that carries a hidden-information game's state is a leak with a retention
 *   policy attached.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  error: 40,
  info: 20,
  warn: 30,
};

export type LogFields = Record<string, unknown>;

export type Logger = {
  readonly level: LogLevel;
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
  /** Same sink and level, with fields merged into every subsequent line. */
  child: (fields: LogFields) => Logger;
};

export type LoggerOptions = {
  level?: string;
  fields?: LogFields;
  /** Tests capture lines here; production writes to stdout. */
  sink?: (line: string) => void;
  now?: () => Date;
};

function parseLevel(raw: string | undefined, fallback: LogLevel): LogLevel {
  if (raw === undefined) return fallback;
  const normalised = raw.trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(normalised)
    ? (normalised as LogLevel)
    : fallback;
}

/** One level of a log line: every value is serialised before it is written. */
function toLogFields(value: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    out[key] = serialisableValue(item);
  }
  return out;
}

/** Errors survive `JSON.stringify` as `{}`; unwrap them into something readable. */
function serialisableValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      ...(typeof value.stack === "string" ? { stack: value.stack } : {}),
    };
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialisableValue);
  if (value === null || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    out[key] = serialisableValue(item);
  }
  return out;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = parseLevel(options.level ?? process.env.LOG_LEVEL, "info");
  const threshold = SEVERITY[level];
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const baseFields = options.fields ?? {};

  function emit(level: LogLevel, msg: string, fields?: LogFields) {
    if (SEVERITY[level] < threshold) return;

    const line = {
      level,
      time: now().toISOString(),
      msg,
      ...toLogFields(baseFields),
      ...toLogFields(fields ?? {}),
    };

    try {
      sink(JSON.stringify(line));
    } catch {
      // A logger that throws takes the request down with it. Losing one line is
      // the cheaper failure, and there is nowhere left to report it.
    }
  }

  return {
    level,
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (fields) => createLogger({ ...options, fields: { ...baseFields, ...fields } }),
  };
}

/** The process-wide logger. Modules take a `.child({ component })` of this one. */
export const logger = createLogger();
