import { logger } from '../../lib/logger';
import { ReminderRule, ReminderProcessingResult } from './types';
import { calculateReminderWindow } from './helpers/date';
import {
  getDeliverablesDueSoon,
  getOverdueDeliverables,
  getUpcomingPayments,
  getOverduePayments,
  getDealsMissingInvoice,
} from './repository';

export async function processDeliverableDueSoon(
  rule: ReminderRule
): Promise<ReminderProcessingResult> {
  const startTime = Date.now();
  const now = new Date();
  const window = calculateReminderWindow(now, rule.offsetValue, rule.offsetUnit);

  logger.info(
    `[Handler: DELIVERABLE_DUE_SOON] Rule ID: ${rule.id} | Window: ${window.startDate.toISOString()} -> ${window.endDate.toISOString()}`
  );

  const records = await getDeliverablesDueSoon(window.startDate, window.endDate, rule.userId);
  const durationMs = Date.now() - startTime;

  logger.info(
    `[Handler: DELIVERABLE_DUE_SOON] Rule ID: ${rule.id} | Records Found: ${records.length} | Execution Time: ${durationMs}ms`
  );

  return {
    ruleId: rule.id,
    triggerType: rule.triggerType,
    window,
    count: records.length,
    durationMs,
    records,
  };
}

export async function processDeliverableOverdue(
  rule: ReminderRule
): Promise<ReminderProcessingResult> {
  const startTime = Date.now();
  logger.info(`[Handler: DELIVERABLE_OVERDUE] Rule ID: ${rule.id}`);

  const records = await getOverdueDeliverables(rule.userId);
  const durationMs = Date.now() - startTime;

  logger.info(
    `[Handler: DELIVERABLE_OVERDUE] Rule ID: ${rule.id} | Records Found: ${records.length} | Execution Time: ${durationMs}ms`
  );

  return {
    ruleId: rule.id,
    triggerType: rule.triggerType,
    window: null,
    count: records.length,
    durationMs,
    records,
  };
}

export async function processPaymentDue(
  rule: ReminderRule
): Promise<ReminderProcessingResult> {
  const startTime = Date.now();
  const now = new Date();
  const window = calculateReminderWindow(now, rule.offsetValue, rule.offsetUnit);

  logger.info(
    `[Handler: PAYMENT_DUE] Rule ID: ${rule.id} | Window: ${window.startDate.toISOString()} -> ${window.endDate.toISOString()}`
  );

  const records = await getUpcomingPayments(window.startDate, window.endDate, rule.userId);
  const durationMs = Date.now() - startTime;

  logger.info(
    `[Handler: PAYMENT_DUE] Rule ID: ${rule.id} | Records Found: ${records.length} | Execution Time: ${durationMs}ms`
  );

  return {
    ruleId: rule.id,
    triggerType: rule.triggerType,
    window,
    count: records.length,
    durationMs,
    records,
  };
}

export async function processPaymentOverdue(
  rule: ReminderRule
): Promise<ReminderProcessingResult> {
  const startTime = Date.now();
  logger.info(`[Handler: PAYMENT_OVERDUE] Rule ID: ${rule.id}`);

  const records = await getOverduePayments(rule.userId);
  const durationMs = Date.now() - startTime;

  logger.info(
    `[Handler: PAYMENT_OVERDUE] Rule ID: ${rule.id} | Records Found: ${records.length} | Execution Time: ${durationMs}ms`
  );

  return {
    ruleId: rule.id,
    triggerType: rule.triggerType,
    window: null,
    count: records.length,
    durationMs,
    records,
  };
}

export async function processMissingInvoice(
  rule: ReminderRule
): Promise<ReminderProcessingResult> {
  const startTime = Date.now();
  const now = new Date();
  const window = calculateReminderWindow(now, rule.offsetValue, rule.offsetUnit);

  logger.info(
    `[Handler: MISSING_INVOICE] Rule ID: ${rule.id} | Window: ${window.startDate.toISOString()} -> ${window.endDate.toISOString()}`
  );

  const records = await getDealsMissingInvoice(window.startDate, window.endDate, rule.userId);
  const durationMs = Date.now() - startTime;

  logger.info(
    `[Handler: MISSING_INVOICE] Rule ID: ${rule.id} | Records Found: ${records.length} | Execution Time: ${durationMs}ms`
  );

  return {
    ruleId: rule.id,
    triggerType: rule.triggerType,
    window,
    count: records.length,
    durationMs,
    records,
  };
}
