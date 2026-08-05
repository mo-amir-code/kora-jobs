import { ReminderWindow } from '../types';

export function convertOffsetToMilliseconds(offsetValue: number, offsetUnit: string): number {
  const normalizedUnit = offsetUnit.toLowerCase().trim();

  switch (normalizedUnit) {
    case 'minute':
    case 'minutes':
      return offsetValue * 60 * 1000;

    case 'hour':
    case 'hours':
      return offsetValue * 60 * 60 * 1000;

    case 'day':
    case 'days':
      return offsetValue * 24 * 60 * 60 * 1000;

    case 'week':
    case 'weeks':
      return offsetValue * 7 * 24 * 60 * 60 * 1000;

    case 'month':
    case 'months':
      return offsetValue * 30 * 24 * 60 * 60 * 1000;

    default:
      // Default to hours if unknown unit provided
      return offsetValue * 60 * 60 * 1000;
  }
}

export function convertOffsetToDuration(offsetValue: number, offsetUnit: string): { amount: number; unit: string } {
  return {
    amount: offsetValue,
    unit: offsetUnit.toLowerCase().trim(),
  };
}

export function getReminderTargetDate(referenceDate: Date, offsetValue: number, offsetUnit: string): Date {
  const offsetMs = convertOffsetToMilliseconds(offsetValue, offsetUnit);
  return new Date(referenceDate.getTime() + offsetMs);
}

export function calculateReminderWindow(referenceDate: Date, offsetValue: number, offsetUnit: string): ReminderWindow {
  const targetDate = getReminderTargetDate(referenceDate, offsetValue, offsetUnit);

  const startDate = new Date(referenceDate);
  const endDate = new Date(targetDate);

  return { startDate, endDate };
}

export function isWithinReminderWindow(targetDate: Date, window: ReminderWindow): boolean {
  const time = targetDate.getTime();
  return time >= window.startDate.getTime() && time <= window.endDate.getTime();
}
