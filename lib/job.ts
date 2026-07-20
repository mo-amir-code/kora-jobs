import { logger } from './logger';

export type JobHandler = () => Promise<void>;

/**
 * Wrapper function for scheduled jobs (similar to asyncHandler in Express).
 * Wraps job execution with automatic error logging and re-throws
 * so the root dispatcher catches failures and exits with process code 1.
 */
export function createJob(handler: JobHandler): JobHandler {
  return async (): Promise<void> => {
    try {
      await handler();
    } catch (error) {
      logger.error('Job execution encountered an unhandled error:', error);
      throw error;
    }
  };
}
