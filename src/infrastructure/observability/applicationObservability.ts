import type { ApplicationObservability } from "../../application/ports/Observability";
import { createOperationId, logger } from "./logger";

export function createApplicationObservability(): ApplicationObservability {
  return {
    createOperationId,
    debug: (event, fields) => logger.debug(event, fields),
    info: (event, fields) => logger.info(event, fields),
    warn: (event, fields) => logger.warn(event, fields),
    error: (event, errorCode, fields) =>
      logger.error(event, { errorType: "error", errorName: errorCode }, fields),
  };
}
