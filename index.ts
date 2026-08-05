import 'dotenv/config';
import { logger } from './lib/logger';
import { closeTransporter } from './lib/email';

interface JobModule {
  run: () => Promise<void>;
}

type JobLoader = () => Promise<JobModule>;

const registry: Record<string, JobLoader> = {
  'hello-world': () => import('./jobs/hello-world/index'),
  'reminders': () => import('./jobs/reminders/index'),
};

async function dispatch(): Promise<void> {
  const jobName = process.env.JOB_NAME;
  const availableJobs = Object.keys(registry);

  if (!jobName) {
    logger.error(`JOB_NAME environment variable is not defined. Available jobs: ${availableJobs.join(', ')}`);
    closeTransporter();
    process.exit(1);
  }

  const loadJob = registry[jobName];

  if (!loadJob) {
    logger.error(`Job "${jobName}" is not registered. Available jobs: ${availableJobs.join(', ')}`);
    closeTransporter();
    process.exit(1);
  }

  logger.info(`Starting execution for job: "${jobName}"`);

  try {
    const jobModule = await loadJob();
    if (typeof jobModule.run !== 'function') {
      throw new Error(`Job "${jobName}" does not export a run() function.`);
    }
    await jobModule.run();
    logger.info(`Job "${jobName}" completed successfully.`);
    closeTransporter();
    process.exit(0);
  } catch (error) {
    logger.error(`Job "${jobName}" execution failed:`, error);
    closeTransporter();
    process.exit(1);
  }
}

dispatch();
