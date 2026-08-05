/**
 * Parses duration strings stored in next_follow_ups array (e.g. "2 hours", "1 days", "20 minutes", "1 week")
 * into milliseconds.
 */
export function parseDurationToMs(durationStr: string): number {
  if (!durationStr) return 0;
  const parts = durationStr.trim().toLowerCase().split(/\s+/);
  const amount = parseFloat(parts[0]);
  if (isNaN(amount)) return 0;
  const unit = parts[1] || 'hours';

  if (unit.startsWith('minute')) return amount * 60 * 1000;
  if (unit.startsWith('hour')) return amount * 60 * 60 * 1000;
  if (unit.startsWith('day')) return amount * 24 * 60 * 60 * 1000;
  if (unit.startsWith('week')) return amount * 7 * 24 * 60 * 60 * 1000;
  if (unit.startsWith('month')) return amount * 30 * 24 * 60 * 60 * 1000;

  return amount * 60 * 60 * 1000;
}
