import { createJob } from '../../lib/job';
import { logger } from '../../lib/logger';
import { supabase } from '../../lib/supabase';
import { ReminderRule, ReminderProcessingResult } from './types';
import { dispatchNotifications } from './channels/notificationDispatcher';
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
  const reminders = await getReminders();
  logger.info(`Found ${reminders.length} reminders`);

  await iterateOnEachReminderRule(reminders);

  logger.info("reminders job finished");
});

const getReminders = async (): Promise<ReminderRule[]> => {
  logger.info("Getting reminders from Supabase");
  const { data, error } = await supabase
    .from('reminder_rules')
    .select('*')
    .eq('is_active', true);

  if (error) {
    logger.error("Error getting reminders", error);
    throw error;
  }

  logger.info(`Found ${data.length} reminders`);

  return (data || []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    templateId: row.template_id,
    name: row.name,
    triggerType: row.trigger_type,
    offsetValue: row.offset_value,
    offsetUnit: row.offset_unit || 'hours',
    recipients: row.recipients || [],
    messageTemplate: row.message_template,
    channelEmail: row.channel_email,
    channelWhatsapp: row.channel_whatsapp,
    channelPush: row.channel_push,
    isActive: row.is_active,
    lastTriggeredAt: row.last_triggered_at,
    createdAt: row.created_at,
  }));
};

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

    case 'PAYMENT_DUE':
      return await processPaymentDue(reminderRule);

    case 'PAYMENT_OVERDUE':
      return await processPaymentOverdue(reminderRule);

    case 'MISSING_INVOICE':
      return await processMissingInvoice(reminderRule);

    default:
      throw new Error(`Unsupported reminder trigger type: ${(reminderRule as any).triggerType}`);
  }
};