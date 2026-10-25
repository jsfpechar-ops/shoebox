import { createLogger } from './logger';

export { LOG_FIELD_ALLOWLIST, type LogField, type LogValue, pickAllowed } from './allowlist';
export {
  createLogger,
  type LogContext,
  type Logger,
  type LoggerOptions,
  withContext,
} from './logger';

/** Process-wide logger (M12 §6). Apps that know their request context use withContext(logger, ...). */
export const logger = createLogger({
  service: process.env.K_SERVICE ?? 'local',
  env: process.env.APP_ENV ?? 'local',
  release: process.env.RELEASE ?? 'dev',
});
