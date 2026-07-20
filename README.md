# kora-jobs

Scheduled job container service hosting multiple independent scheduled jobs bundled into a single Docker image.

## Environment Variables

- **`SUPABASE_URL`**: Supabase project URL from **Settings → API Keys** (or **Settings → Data API**), using the base URL without the `/rest/v1/` suffix.
- **`SUPABASE_SECRET_KEY`**: Supabase secret key from **Settings → API Keys → Secret keys** (new key system, not the legacy `service_role` key).
- **`JOB_NAME`**: Name of the job to execute (must match a folder name under `jobs/`).

## Logging convention

There is no dedicated `prefix/` directory or file — logging prefix logic lives entirely inside `lib/logger.ts`. Every log line emitted via `logger.info`, `logger.warn`, or `logger.error` is automatically prefixed with three things: the job name (from `process.env.JOB_NAME`), an ISO 8601 timestamp, and the log level.

```text
[job-name] 2026-07-20T10:32:01.123Z [INFO] message here
```

**Why this exists:** Since multiple jobs share one Docker image and one log stream (Cloud Run Logs / GitHub Actions logs), the prefix makes it possible to trace any log line back to the specific job that produced it.

**Convention for job authors:** Always import `logger` from `lib/logger.ts` and use `logger.info`/`warn`/`error` instead of raw `console.log`, so every new job automatically follows this format with zero extra setup.
