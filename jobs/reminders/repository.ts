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

  if (!data || data.length === 0) {
    return [];
  }

  // Find rules that lack inline message_template but specify a template_id
  const templateIdsToFetch = Array.from(
    new Set(
      data
        .filter((row: any) => (!row.message_template || !row.message_template.trim()) && row.template_id)
        .map((row: any) => row.template_id)
    )
  );

  const templatesMap = new Map<string, { body: string; name: string }>();

  if (templateIdsToFetch.length > 0) {
    logger.info(`Repository: Resolving ${templateIdsToFetch.length} message templates from message_templates table...`);
    const { data: tData, error: tErr } = await supabase
      .from('message_templates')
      .select('id, body, name')
      .in('id', templateIdsToFetch);

    if (tErr) {
      logger.error('Repository Error: Failed to fetch referenced message_templates', tErr);
    } else if (tData) {
      for (const t of tData) {
        templatesMap.set(t.id, { body: t.body, name: t.name });
      }
    }
  }

  // Map database snake_case fields to camelCase ReminderRule model
  return data.map((row: any) => {
    const inlineTemplate = row.message_template && row.message_template.trim().length > 0
      ? row.message_template
      : null;

    const referencedTemplate = row.template_id ? templatesMap.get(row.template_id) : null;
    
    // Priority: 1. Inline message_template on reminder_rule -> 2. Referenced message_templates.body via template_id -> 3. null
    const resolvedBody = inlineTemplate || referencedTemplate?.body || null;
    const resolvedName = row.name || referencedTemplate?.name || null;

    logger.info(`Repository: Rule "${resolvedName || row.id}" resolved messageTemplate: ${resolvedBody ? `"${resolvedBody.substring(0, 60)}..."` : 'NULL (Will use default fallback)'}`);

    return {
      id: row.id,
      userId: row.user_id,
      templateId: row.template_id,
      name: resolvedName,
      triggerType: row.trigger_type,
      offsetValue: row.offset_value,
      offsetUnit: row.offset_unit || 'hours',
      nextFollowUps: row.next_follow_ups || [],
      recipients: row.recipients || [],
      messageTemplate: resolvedBody,
      channelEmail: row.channel_email ?? true,
      channelWhatsapp: row.channel_whatsapp ?? false,
      channelPush: row.channel_push ?? true,
      isActive: row.is_active ?? true,
      lastTriggeredAt: row.last_triggered_at,
      createdAt: row.created_at,
    };
  });
}

export async function getDeliverablesDueSoon(
  startDate: Date,
  endDate: Date,
  userId: string
): Promise<DeliverableRecord[]> {
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  logger.info(`Repository: Fetching deliverables due between ${startStr} and ${endStr} for user ${userId}`);

  const { data, error } = await supabase
    .from('deliverables')
    .select('*, deals!inner(user_id, title, brand_id, amount, amount_paid, currency, brand_contacts(name), brands(name))')
    .eq('deals.user_id', userId)
    .gte('due_date', startStr)
    .lte('due_date', endStr)
    .eq('is_completed', false);

  if (error) {
    logger.error('Repository Error: Failed to fetch deliverables due soon', error);
    throw error;
  }

  return (data || []).map((row: any) => {
    const dealAmt = row.deals?.amount ? Number(row.deals.amount) : null;
    const paidAmt = row.deals?.amount_paid ? Number(row.deals.amount_paid) : 0;
    const dueAmt = dealAmt != null ? Math.max(0, dealAmt - paidAmt) : null;

    return {
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
      contactName: row.deals?.brand_contacts?.name || null,
      dealAmount: dealAmt,
      amountPaid: paidAmt,
      dueAmount: dueAmt,
      currency: row.deals?.currency || 'USD',
    };
  });
}

export async function getOverdueDeliverables(userId: string): Promise<DeliverableRecord[]> {
  const nowISO = new Date().toISOString();
  logger.info(`Repository: Fetching overdue deliverables (due before ${nowISO}) for user ${userId}`);

  const { data, error } = await supabase
    .from('deliverables')
    .select('*, deals!inner(user_id, title, brand_id, amount, amount_paid, currency, brand_contacts(name), brands(name))')
    .eq('deals.user_id', userId)
    .lt('due_date', nowISO)
    .eq('is_completed', false);

  if (error) {
    logger.error('Repository Error: Failed to fetch overdue deliverables', error);
    throw error;
  }

  return (data || []).map((row: any) => {
    const dealAmt = row.deals?.amount ? Number(row.deals.amount) : null;
    const paidAmt = row.deals?.amount_paid ? Number(row.deals.amount_paid) : 0;
    const dueAmt = dealAmt != null ? Math.max(0, dealAmt - paidAmt) : null;

    return {
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
      contactName: row.deals?.brand_contacts?.name || null,
      dealAmount: dealAmt,
      amountPaid: paidAmt,
      dueAmount: dueAmt,
      currency: row.deals?.currency || 'USD',
    };
  });
}

export async function getUpcomingPayments(
  startDate: Date,
  endDate: Date,
  userId: string
): Promise<DealRecord[]> {
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  logger.info(`Repository: Fetching payments due between ${startStr} and ${endStr} for user ${userId}`);

  const { data, error } = await supabase
    .from('deals')
    .select('*, brands(name), brand_contacts(name)')
    .eq('user_id', userId)
    .gte('payment_due_date', startStr)
    .lte('payment_due_date', endStr)
    .neq('payment_status', 'PAID');

  if (error) {
    logger.error('Repository Error: Failed to fetch upcoming payments', error);
    throw error;
  }

  return (data || []).map((row: any) => {
    const dealAmt = row.amount ? Number(row.amount) : null;
    const paidAmt = row.amount_paid ? Number(row.amount_paid) : 0;
    const dueAmt = dealAmt != null ? Math.max(0, dealAmt - paidAmt) : null;

    return {
      id: row.id,
      userId: row.user_id,
      brandId: row.brand_id,
      contactId: row.contact_id,
      title: row.title,
      stage: row.stage,
      amount: dealAmt,
      currency: row.currency || 'USD',
      paymentTerms: row.payment_terms,
      paymentDueDate: row.payment_due_date,
      paymentStatus: row.payment_status,
      amountPaid: paidAmt,
      dueAmount: dueAmt,
      createdAt: row.created_at,
      dealTitle: row.title,
      brandName: row.brands?.name || null,
      contactName: row.brand_contacts?.name || null,
    };
  });
}

export async function getOverduePayments(userId: string): Promise<DealRecord[]> {
  const nowISO = new Date().toISOString();
  logger.info(`Repository: Fetching overdue payments (due before ${nowISO}) for user ${userId}`);

  const { data, error } = await supabase
    .from('deals')
    .select('*, brands(name), brand_contacts(name)')
    .eq('user_id', userId)
    .lt('payment_due_date', nowISO)
    .neq('payment_status', 'PAID');

  if (error) {
    logger.error('Repository Error: Failed to fetch overdue payments', error);
    throw error;
  }

  return (data || []).map((row: any) => {
    const dealAmt = row.amount ? Number(row.amount) : null;
    const paidAmt = row.amount_paid ? Number(row.amount_paid) : 0;
    const dueAmt = dealAmt != null ? Math.max(0, dealAmt - paidAmt) : null;

    return {
      id: row.id,
      userId: row.user_id,
      brandId: row.brand_id,
      contactId: row.contact_id,
      title: row.title,
      stage: row.stage,
      amount: dealAmt,
      currency: row.currency || 'USD',
      paymentTerms: row.payment_terms,
      paymentDueDate: row.payment_due_date,
      paymentStatus: row.payment_status,
      amountPaid: paidAmt,
      dueAmount: dueAmt,
      createdAt: row.created_at,
      dealTitle: row.title,
      brandName: row.brands?.name || null,
      contactName: row.brand_contacts?.name || null,
    };
  });
}

export async function getDealsMissingInvoice(
  startDate: Date,
  endDate: Date,
  userId: string
): Promise<DealRecord[]> {
  logger.info(`Repository: Fetching active deals created between ${startDate.toISOString()} and ${endDate.toISOString()} missing an invoice for user ${userId}`);

  const { data, error } = await supabase
    .from('deals')
    .select('*, invoices(id), brands(name), brand_contacts(name)')
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

  return dealsMissingInvoice.map((row: any) => {
    const dealAmt = row.amount ? Number(row.amount) : null;
    const paidAmt = row.amount_paid ? Number(row.amount_paid) : 0;
    const dueAmt = dealAmt != null ? Math.max(0, dealAmt - paidAmt) : null;

    return {
      id: row.id,
      userId: row.user_id,
      brandId: row.brand_id,
      contactId: row.contact_id,
      title: row.title,
      stage: row.stage,
      amount: dealAmt,
      currency: row.currency || 'USD',
      paymentTerms: row.payment_terms,
      paymentDueDate: row.payment_due_date,
      paymentStatus: row.payment_status,
      amountPaid: paidAmt,
      dueAmount: dueAmt,
      createdAt: row.created_at,
      dealTitle: row.title,
      brandName: row.brands?.name || null,
      contactName: row.brand_contacts?.name || null,
    };
  });
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

export async function hasReminderLogBeenSent(params: {
  userId: string;
  dealId?: string | null;
  triggerType: string;
  resource?: string | null;
  followUpIndex?: number;
}): Promise<boolean> {
  let query = supabase
    .from('reminder_rule_logs')
    .select('id')
    .eq('user_id', params.userId)
    .eq('trigger_type', params.triggerType)
    .eq('follow_up_index', params.followUpIndex ?? -1)
    .eq('status', 'SUCCESS');

  if (params.dealId) {
    query = query.eq('deal_id', params.dealId);
  }
  if (params.resource) {
    query = query.eq('resource', params.resource);
  } else {
    query = query.is('resource', null);
  }

  const { data, error } = await query.limit(1);
  if (error) {
    logger.error('Repository Error: Failed to check if reminder log has been sent', error);
    return false;
  }

  return !!data && data.length > 0;
}

export async function getPreviousReminderLogTimestamp(params: {
  userId: string;
  dealId?: string | null;
  triggerType: string;
  resource?: string | null;
  followUpIndex: number;
}): Promise<Date | null> {
  let query = supabase
    .from('reminder_rule_logs')
    .select('created_at')
    .eq('user_id', params.userId)
    .eq('trigger_type', params.triggerType)
    .eq('follow_up_index', params.followUpIndex)
    .eq('status', 'SUCCESS');

  if (params.dealId) {
    query = query.eq('deal_id', params.dealId);
  }
  if (params.resource) {
    query = query.eq('resource', params.resource);
  } else {
    query = query.is('resource', null);
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
  if (error || !data || data.length === 0) {
    return null;
  }

  return new Date(data[0].created_at);
}

export async function createReminderRuleLog(logData: {
  reminderRuleId: string;
  userId: string;
  dealId?: string | null;
  triggerType: string;
  resource?: string | null;
  followUpIndex?: number;
  attempt?: number;
  status: ReminderExecutionStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  providerMessageId?: string | null;
  startedAt: Date;
  completedAt?: Date;
}): Promise<void> {
  const followUpIdx = logData.followUpIndex ?? -1;
  logger.info(
    `Repository: Creating ReminderRuleLog for rule ${logData.reminderRuleId} | user: ${logData.userId} | deal: ${logData.dealId || 'N/A'} | resource: ${logData.resource || 'N/A'} | followUpIndex: ${followUpIdx} | status: ${logData.status}`
  );

  const { error } = await supabase.from('reminder_rule_logs').insert({
    id: crypto.randomUUID(),
    reminder_rule_id: logData.reminderRuleId,
    user_id: logData.userId,
    deal_id: logData.dealId || null,
    trigger_type: logData.triggerType,
    resource: logData.resource || null,
    follow_up_index: followUpIdx,
    attempt: logData.attempt || 1,
    status: logData.status,
    error_code: logData.errorCode || null,
    error_message: logData.errorMessage || null,
    provider_message_id: logData.providerMessageId || null,
    started_at: logData.startedAt.toISOString(),
    completed_at: (logData.completedAt || new Date()).toISOString(),
  });

  if (error) {
    // Graceful fallback for legacy database schemas before `prisma db push` / SQL migration is executed
    logger.warn(`Repository: Schema migration pending for reminder_rule_logs. Falling back to basic log format...`);
    const { error: fallbackError } = await supabase.from('reminder_rule_logs').insert({
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

    if (fallbackError) {
      logger.error(`Repository Error: Failed to create ReminderRuleLog for rule ${logData.reminderRuleId}:`, fallbackError);
    }
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

export interface BrandContactInfo {
  id: string;
  brandId: string;
  name: string;
  email: string | null;
  whatsapp: string | null;
  isPrimary: boolean;
}

export async function getPrimaryBrandContact(
  brandId: string,
  contactId?: string | null
): Promise<BrandContactInfo | null> {
  if (contactId) {
    const { data } = await supabase
      .from('brand_contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (data) {
      return {
        id: data.id,
        brandId: data.brand_id,
        name: data.name,
        email: data.email || null,
        whatsapp: data.whatsapp || null,
        isPrimary: data.is_primary || false,
      };
    }
  }

  const { data } = await supabase
    .from('brand_contacts')
    .select('*')
    .eq('brand_id', brandId)
    .eq('is_primary', true)
    .limit(1)
    .single();

  if (data) {
    return {
      id: data.id,
      brandId: data.brand_id,
      name: data.name,
      email: data.email || null,
      whatsapp: data.whatsapp || null,
      isPrimary: data.is_primary || false,
    };
  }

  // Fallback: first contact for brand
  const { data: firstContact } = await supabase
    .from('brand_contacts')
    .select('*')
    .eq('brand_id', brandId)
    .limit(1)
    .single();

  if (!firstContact) return null;

  return {
    id: firstContact.id,
    brandId: firstContact.brand_id,
    name: firstContact.name,
    email: firstContact.email || null,
    whatsapp: firstContact.whatsapp || null,
    isPrimary: firstContact.is_primary || false,
  };
}

export async function getAllBrandContacts(brandId: string): Promise<BrandContactInfo[]> {
  const { data, error } = await supabase
    .from('brand_contacts')
    .select('*')
    .eq('brand_id', brandId);

  if (error || !data) {
    return [];
  }

  return data.map((row: any) => ({
    id: row.id,
    brandId: row.brand_id,
    name: row.name,
    email: row.email || null,
    whatsapp: row.whatsapp || null,
    isPrimary: row.is_primary || false,
  }));
}
