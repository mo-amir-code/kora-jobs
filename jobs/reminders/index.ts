import { createJob } from '../../lib/job';
import { logger } from '../../lib/logger';
import { ReminderRule, ReminderProcessingResult } from './types';
import { dispatchNotifications } from './channels/notificationDispatcher';
import { getReminderRules } from './repository';
import {
  processDeliverableDueSoon,
  processDeliverableOverdue,
  processPaymentDue,
  processPaymentOverdue,
  processMissingInvoice,
} from './handlers';

export const run = createJob(async () => {
  logger.info("reminders job started");
  logger.info(`Current job timestamp: ${new Date().toISOString()}`);

  logger.info(`Fetching reminders rules...`);
  const reminders = await getReminderRules();
  logger.info(`Found ${reminders.length} reminders`);

  await iterateOnEachReminderRule(reminders);

  logger.info("reminders job finished");
});

const iterateOnEachReminderRule = async (
  reminderRules: ReminderRule[]
): Promise<ReminderProcessingResult[]> => {
  const results: ReminderProcessingResult[] = [];

  for (const rule of reminderRules) {
    const ruleName = rule.name ? `"${rule.name}" (${rule.id})` : `(${rule.id})`;
    logger.info(`Processing reminder rule ${ruleName} | Trigger: ${rule.triggerType}`);

    try {
      const result = await processReminderRule(rule);
      results.push(result);
      logger.info(`Successfully processed reminder rule ${ruleName}`);

      // Dispatch channel notifications (Email via Nodemailer + WhatsApp TODO stub)
      await dispatchNotifications(rule, result);
    } catch (error) {
      logger.error(`Failed to process reminder rule ${ruleName}:`, error);
      // One failed rule must not block remaining rules
    }
  }

  return results;
};

const processReminderRule = async (
  reminderRule: ReminderRule
): Promise<ReminderProcessingResult> => {
  switch (reminderRule.triggerType) {
    case 'DELIVERABLE_DUE_SOON':
      return await processDeliverableDueSoon(reminderRule);

    case 'DELIVERABLE_OVERDUE':
      return await processDeliverableOverdue(reminderRule);

    case 'PAYMENT_DUE_SOON':
      return await processPaymentDue(reminderRule);

    case 'PAYMENT_OVERDUE':
      return await processPaymentOverdue(reminderRule);

    case 'MISSING_INVOICE':
      return await processMissingInvoice(reminderRule);

    default:
      throw new Error(`Unsupported reminder trigger type: ${(reminderRule as any).triggerType}`);
  }
};