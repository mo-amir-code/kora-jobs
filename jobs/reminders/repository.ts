import crypto from 'crypto';
import { supabase } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { ReminderRule, DeliverableRecord, DealRecord, InvoiceRecord, ReminderExecutionStatus } from './types';

export async function getReminderRules(): Promise<ReminderRule[]> {
  logger.info('Repository: Fetching active reminder rules from database...');
  const { data, error } = await supabase
    .from('reminder_rules')
    .select('*')
    .eq('is_active', true);

  if (error) {
    logger.error('Repository Error: Failed to fetch reminder rules', error);
    throw error;
  }

  if (!data) {
    return [];
  }

  // Map database snake_case fields to camelCase ReminderRule model
  return data.map((row: any) => ({
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
}

export async function getDeliverablesDueSoon(
  startDate: Date,
  endDate: Date,
  userId: string
): Promise<DeliverableRecord[]> {
  logger.info(`Repository: Fetching deliverables due between ${startDate.toISOString()} and ${endDate.toISOString()} for user ${userId}`);

  const { data, error } = await supabase
    .from('deliverables')
    .select('*, deals!inner(user_id, title, brand_id, brands(name))')
    .eq('deals.user_id', userId)
    .gte('due_date', startDate.toISOString())
    .lte('due_date', endDate.toISOString())
    .eq('is_completed', false);

  if (error) {
    logger.error('Repository Error: Failed to fetch deliverables due soon', error);
    throw error;
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    dealId: row.deal_id,
    type: row.type,
    quantity: row.quantity,
    platform: row.platform,
    dueDate: row.due_date,
    isCompleted: row.is_completed,
    completedAt: row.completed_at,
    dealTitle: row.deals?.title || null,
    brandName: row.deals?.brands?.name || null,
  }));
}

export async function getOverdueDeliverables(userId: string): Promise<DeliverableRecord[]> {
  const nowISO = new Date().toISOString();
  logger.info(`Repository: Fetching overdue deliverables (due before ${nowISO}) for user ${userId}`);

  const { data, error } = await supabase
    .from('deliverables')
    .select('*, deals!inner(user_id, title, brand_id, brands(name))')
    .eq('deals.user_id', userId)
    .lt('due_date', nowISO)
    .eq('is_completed', false);

  if (error) {
    logger.error('Repository Error: Failed to fetch overdue deliverables', error);
    throw error;
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    dealId: row.deal_id,
    type: row.type,
    quantity: row.quantity,
    platform: row.platform,
    dueDate: row.due_date,
    isCompleted: row.is_completed,
    completedAt: row.completed_at,
    dealTitle: row.deals?.title || null,
    brandName: row.deals?.brands?.name || null,
  }));
}

export async function getUpcomingPayments(
  startDate: Date,
  endDate: Date,
  userId: string
): Promise<DealRecord[]> {
  logger.info(`Repository: Fetching payments due between ${startDate.toISOString()} and ${endDate.toISOString()} for user ${userId}`);

  const { data, error } = await supabase
    .from('deals')
    .select('*, brands(name)')
    .eq('user_id', userId)
    .gte('payment_due_date', startDate.toISOString())
    .lte('payment_due_date', endDate.toISOString())
    .neq('payment_status', 'PAID');

  if (error) {
    logger.error('Repository Error: Failed to fetch upcoming payments', error);
    throw error;
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    brandId: row.brand_id,
    contactId: row.contact_id,
    title: row.title,
    stage: row.stage,
    amount: row.amount,
    currency: row.currency,
    paymentTerms: row.payment_terms,
    paymentDueDate: row.payment_due_date,
    paymentStatus: row.payment_status,
    amountPaid: row.amount_paid,
    createdAt: row.created_at,
    dealTitle: row.title,
    brandName: row.brands?.name || null,
  }));
}

export async function getOverduePayments(userId: string): Promise<DealRecord[]> {
  const nowISO = new Date().toISOString();
  logger.info(`Repository: Fetching overdue payments (due before ${nowISO}) for user ${userId}`);

  const { data, error } = await supabase
    .from('deals')
    .select('*, brands(name)')
    .eq('user_id', userId)
    .lt('payment_due_date', nowISO)
    .neq('payment_status', 'PAID');

  if (error) {
    logger.error('Repository Error: Failed to fetch overdue payments', error);
    throw error;
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    brandId: row.brand_id,
    contactId: row.contact_id,
    title: row.title,
    stage: row.stage,
    amount: row.amount,
    currency: row.currency,
    paymentTerms: row.payment_terms,
    paymentDueDate: row.payment_due_date,
    paymentStatus: row.payment_status,
    amountPaid: row.amount_paid,
    createdAt: row.created_at,
    dealTitle: row.title,
    brandName: row.brands?.name || null,
  }));
}

export async function getDealsMissingInvoice(
  startDate: Date,
  endDate: Date,
  userId: string
): Promise<DealRecord[]> {
  logger.info(`Repository: Fetching active deals created between ${startDate.toISOString()} and ${endDate.toISOString()} missing an invoice for user ${userId}`);

  const { data, error } = await supabase
    .from('deals')
    .select('*, invoices(id), brands(name)')
    .eq('user_id', userId)
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())
    .in('stage', ['IN_PROGRESS', 'APPROVED', 'COMPLETED', 'CONTRACT_SENT']);

  if (error) {
    logger.error('Repository Error: Failed to fetch deals missing invoice', error);
    throw error;
  }

  const dealsMissingInvoice = (data || []).filter(
    (deal: any) => !deal.invoices || deal.invoices.length === 0
  );

  return dealsMissingInvoice.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    brandId: row.brand_id,
    contactId: row.contact_id,
    title: row.title,
    stage: row.stage,
    amount: row.amount,
    currency: row.currency,
    paymentTerms: row.payment_terms,
    paymentDueDate: row.payment_due_date,
    paymentStatus: row.payment_status,
    amountPaid: row.amount_paid,
    createdAt: row.created_at,
    dealTitle: row.title,
    brandName: row.brands?.name || null,
  }));
}

export async function getUserEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .single();

  if (error || !data) {
    logger.warn(`Repository: Could not fetch email for userId: ${userId}`);
    return null;
  }

  return data.email;
}

export async function createReminderRuleLog(logData: {
  reminderRuleId: string;
  attempt?: number;
  status: ReminderExecutionStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  providerMessageId?: string | null;
  startedAt: Date;
  completedAt?: Date;
}): Promise<void> {
  logger.info(`Repository: Creating ReminderRuleLog for rule ${logData.reminderRuleId} with status ${logData.status}`);

  const { error } = await supabase.from('reminder_rule_logs').insert({
    id: crypto.randomUUID(),
    reminder_rule_id: logData.reminderRuleId,
    attempt: logData.attempt || 1,
    status: logData.status,
    error_code: logData.errorCode || null,
    error_message: logData.errorMessage || null,
    provider_message_id: logData.providerMessageId || null,
    started_at: logData.startedAt.toISOString(),
    completed_at: (logData.completedAt || new Date()).toISOString(),
  });

  if (error) {
    logger.error(`Repository Error: Failed to create ReminderRuleLog for rule ${logData.reminderRuleId}:`, error);
  }
}

export async function updateReminderRuleLastTriggeredAt(ruleId: string, timestamp: Date = new Date()): Promise<void> {
  logger.info(`Repository: Updating last_triggered_at for rule ${ruleId} to ${timestamp.toISOString()}`);

  const { error } = await supabase
    .from('reminder_rules')
    .update({ last_triggered_at: timestamp.toISOString() })
    .eq('id', ruleId);

  if (error) {
    logger.error(`Repository Error: Failed to update last_triggered_at for rule ${ruleId}:`, error);
  }
}
