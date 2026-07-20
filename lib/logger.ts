function formatMessage(level: string, message: string): string {
  const jobName = process.env.JOB_NAME || 'UNKNOWN_JOB';
  const timestamp = new Date().toISOString();
  return `[${jobName}] ${timestamp} [${level.toUpperCase()}] ${message}`;
}

export const logger = {
  info: (message: string, ...args: any[]): void => {
    console.log(formatMessage('info', message), ...args);
  },
  warn: (message: string, ...args: any[]): void => {
    console.warn(formatMessage('warn', message), ...args);
  },
  error: (message: string, ...args: any[]): void => {
    console.error(formatMessage('error', message), ...args);
  },
};
