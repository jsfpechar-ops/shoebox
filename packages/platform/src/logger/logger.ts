import {
  type Bindings,
  type ChildLoggerOptions,
  type DestinationStream,
  type LevelWithSilent,
  type LogFn,
  type Logger,
  pino,
} from 'pino';
import { pickAllowed } from './allowlist';

export type { Logger } from 'pino';

export interface LoggerOptions {
  service: string;
  env: string;
  release: string;
  level?: LevelWithSilent;
  /** Tests pass a collecting stream; production writes JSON to stdout. */
  destination?: DestinationStream;
}

/** Per-request or per-job context. requestId and traceId are mandatory (M12 §4.7). */
export interface LogContext {
  requestId: string;
  traceId: string;
  orgId?: string;
  userId?: string;
  jobName?: string;
  jobId?: string;
  documentId?: string;
  stage?: string;
}

function errorCodeOf(err: Error): string {
  const code: unknown = (err as Error & { code?: unknown }).code;
  return typeof code === 'string' ? code : err.name;
}

/**
 * Normalizes every log call so content cannot leak through pino's side doors:
 * an Error becomes `{ errorCode }` (its message and stack are dropped), and
 * printf-style arguments are never interpolated into msg.
 */
function safeArgs(args: unknown[]): Parameters<LogFn> {
  const [first, second] = args;
  if (first instanceof Error) {
    const msg = typeof second === 'string' ? second : first.name;
    return [{ errorCode: errorCodeOf(first) }, msg];
  }
  if (typeof first === 'string') return [first];
  if (typeof first === 'object' && first !== null) {
    return typeof second === 'string' ? [first, second] : [first];
  }
  return [''];
}

export function createLogger(options: LoggerOptions): Logger {
  const config = {
    level: options.level ?? 'info',
    base: pickAllowed({ service: options.service, env: options.env, release: options.release }),
    messageKey: 'msg',
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: {
      level: (label: string) => ({ level: label }),
      bindings: (bindings: Record<string, unknown>) => pickAllowed(bindings),
      log: (object: Record<string, unknown>) => pickAllowed(object),
    },
    hooks: {
      logMethod(this: Logger, args: unknown[], method: LogFn) {
        method.apply(this, safeArgs(args));
      },
    },
  };
  const root = options.destination ? pino(config, options.destination) : pino(config);
  // pino applies formatters.bindings to the root only; children inherit this guarded child().
  const pinoChild = root.child;
  function guardedChild(this: unknown, bindings: Bindings, childOptions?: ChildLoggerOptions) {
    return Reflect.apply(pinoChild, this, [pickAllowed(bindings), childOptions]) as unknown;
  }
  root.child = guardedChild as Logger['child'];
  return root;
}

export function withContext(logger: Logger, context: LogContext): Logger {
  return logger.child(context);
}
