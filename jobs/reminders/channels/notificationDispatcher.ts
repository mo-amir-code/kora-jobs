import { logger } from '../../../lib/logger';
import { sendEmail } from '../../../lib/email';
import { KORA_LOGO_LIGHT_MODE, KORA_APP_URL } from '../../../lib/constants';
import { ReminderRule, ReminderProcessingResult } from '../types';
import { parseDurationToMs } from '../helpers/duration';
import {
  getUserEmail,
  getPrimaryBrandContact,
  getAllBrandContacts,
  createReminderRuleLog,
  hasReminderLogBeenSent,
  getPreviousReminderLogTimestamp,
  updateReminderRuleLastTriggeredAt,
} from '../repository';

/**
 * Evaluates whether an item needs an initial reminder (followUpIndex: -1)
 * or a specific follow-up step (followUpIndex: 0, 1, 2...) based on time elapsed since the previous log.
 * Returns the followUpIndex to process, or null if skipping.
 */
export async function evaluateItemFollowUpStep(rule: ReminderRule, record: any): Promise<number | null> {
  const dealId = record.dealId || record.id || null;
  const userId = rule.userId;
  const triggerType = rule.triggerType;
  const resource = triggerType.includes('DELIVERABLE') ? record.id : null;

  // 1. Check Initial Reminder (followUpIndex: -1)
  const initialSent = await hasReminderLogBeenSent({
    userId,
    dealId,
    triggerType,
    resource,
    followUpIndex: -1,
  });

  if (!initialSent) {
    // Initial reminder has NOT been sent yet. Return -1 to send initial notification!
    return -1;
  }

  // 2. Check Follow-ups if initial reminder WAS already sent
  const followUps = rule.nextFollowUps || [];
  if (followUps.length === 0) {
    return null; // No follow-ups configured
  }

  for (let i = 0; i < followUps.length; i++) {
    const followUpAlreadySent = await hasReminderLogBeenSent({
      userId,
      dealId,
      triggerType,
      resource,
      followUpIndex: i,
    });

    if (!followUpAlreadySent) {
      // Get previous step's log timestamp to check if required delay has elapsed
      const prevStepIndex = i === 0 ? -1 : i - 1;
      const prevLogTime = await getPreviousReminderLogTimestamp({
        userId,
        dealId,
        triggerType,
        resource,
        followUpIndex: prevStepIndex,
      });

      if (!prevLogTime) {
        return null;
      }

      const requiredDelayMs = parseDurationToMs(followUps[i]);
      const timeElapsedMs = Date.now() - prevLogTime.getTime();

      if (timeElapsedMs >= requiredDelayMs) {
        // Required delay has passed for follow-up i! Return i.
        return i;
      }

      // Time condition not yet met for this follow-up. Wait for future job runs.
      return null;
    }
  }

  return null; // All follow-ups already sent for this item
}

export async function dispatchNotifications(
  rule: ReminderRule,
  result: ReminderProcessingResult
): Promise<void> {
  const startedAt = new Date();

  if (result.count === 0) {
    logger.info(`[Notification Dispatcher] Rule "${rule.name || rule.id}": 0 matching events. Skipping notifications.`);
    return;
  }

  // Evaluate which items are eligible for initial notification (-1) or a follow-up step (0..N)
  const itemsToDispatch: { record: any; followUpIndex: number }[] = [];
  for (const record of result.records) {
    const followUpIdx = await evaluateItemFollowUpStep(rule, record);
    if (followUpIdx !== null) {
      itemsToDispatch.push({ record, followUpIndex: followUpIdx });
    }
  }

  if (itemsToDispatch.length === 0) {
    logger.info(
      `[Notification Dispatcher] Rule "${rule.name || rule.id}": All ${result.count} matched items have already been notified or are waiting for follow-up delay. Skipping.`
    );
    return;
  }

  logger.info(
    `[Notification Dispatcher] Processing notifications for rule "${rule.name || rule.id}" (${itemsToDispatch.length} items eligible for dispatch)`
  );

  const dispatchResult: ReminderProcessingResult = {
    ...result,
    count: itemsToDispatch.length,
    records: itemsToDispatch.map((i) => i.record),
  };

  try {
    // 1. EMAIL CHANNEL
    if (rule.channelEmail) {
      const emailSentSuccessfully = await sendAggregatedEmailNotification(rule, dispatchResult);
      if (!emailSentSuccessfully) {
        throw new Error(`Failed to send email notifications for rule "${rule.name || rule.id}"`);
      }
    } else {
      logger.info(`[Email Channel] Rule "${rule.name || rule.id}": Disabled in rule configuration. Skipping.`);
    }

    // 2. WHATSAPP CHANNEL (TODO STUB FOR INTEGRATION)
    if (rule.channelWhatsapp) {
      await processWhatsAppNotificationStub(rule, dispatchResult);
    }

    const completedAt = new Date();

    // Record SUCCESS in reminder_rule_logs table for EACH dispatched item and its specific followUpIndex
    for (const item of itemsToDispatch) {
      const dealId = item.record.dealId || item.record.id || null;
      const resource = rule.triggerType.includes('DELIVERABLE') ? item.record.id : null;

      await createReminderRuleLog({
        reminderRuleId: rule.id,
        userId: rule.userId,
        dealId,
        triggerType: rule.triggerType,
        resource,
        followUpIndex: item.followUpIndex,
        status: 'SUCCESS',
        startedAt,
        completedAt,
      });
    }

    // Update last_triggered_at on the reminder_rules table
    await updateReminderRuleLastTriggeredAt(rule.id, completedAt);

  } catch (error: any) {
    logger.error(`[Notification Dispatcher] Error dispatching notifications for rule "${rule.name || rule.id}":`, error);

    // Record FAILED in reminder_rule_logs table for EACH item
    for (const item of itemsToDispatch) {
      const dealId = item.record.dealId || item.record.id || null;
      const resource = rule.triggerType.includes('DELIVERABLE') ? item.record.id : null;

      await createReminderRuleLog({
        reminderRuleId: rule.id,
        userId: rule.userId,
        dealId,
        triggerType: rule.triggerType,
        resource,
        followUpIndex: item.followUpIndex,
        status: 'FAILED',
        startedAt,
        completedAt: new Date(),
        errorMessage: error?.message || String(error),
      });
    }
  }
}

/**
 * Interpolates template string placeholders (e.g. [Contact Name], [Brand Name], [Deal Amount], [Due Date], [Invoice Link])
 * with real dynamic values from the record / deal.
 */
export function interpolatePlaceholders(
  templateText: string,
  record: any,
  dealTitle: string,
  brandName: string,
  options: { isHtml?: boolean } = {}
): string {
  if (!templateText) return '';

  const contactName = record?.contactName || record?.deals?.brand_contacts?.name || 'there';
  const currencyVal = record?.currency || 'USD';
  const symbol = currencyVal === 'INR' ? '₹' : '$';

  const totalAmt = record?.dealAmount ?? record?.amount;
  const totalAmountFormatted = totalAmt != null
    ? `${symbol}${Number(totalAmt).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '$0.00';

  const paidAmt = record?.amountPaid ?? 0;
  const amountPaidFormatted = `${symbol}${Number(paidAmt).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const dueAmt = record?.dueAmount ?? (totalAmt != null ? Math.max(0, totalAmt - paidAmt) : null);
  const dueAmountFormatted = dueAmt != null
    ? `${symbol}${Number(dueAmt).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : totalAmountFormatted;

  const rawDueDate = record?.dueDate || record?.paymentDueDate;
  const dueDateFormatted = rawDueDate
    ? new Date(rawDueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Due Soon';

  const dealId = record?.dealId || record?.id;
  const rawInvoiceUrl = dealId
    ? `${KORA_APP_URL}/dashboard/deals/${dealId}`
    : `${KORA_APP_URL}/dashboard/deals`;

  const invoiceLink = options.isHtml
    ? `<a href="${rawInvoiceUrl}" target="_blank" style="color: #088395; font-weight: 600; text-decoration: underline;">View Invoice / Deal</a>`
    : rawInvoiceUrl;

  const deliverableType = record?.type
    ? `${record.type}${record.platform ? ` (${record.platform})` : ''}`
    : 'Deliverable';

  const replacements: Record<string, string> = {
    '\\[Contact Name\\]': contactName,
    '\\[Brand Name\\]': brandName,
    '\\[Deal Name\\]': dealTitle,
    '\\[Deal Title\\]': dealTitle,
    '\\[Deal Amount\\]': totalAmountFormatted,
    '\\[Total Amount\\]': totalAmountFormatted,
    '\\[Due Amount\\]': dueAmountFormatted,
    '\\[Remaining Amount\\]': dueAmountFormatted,
    '\\[Amount Paid\\]': amountPaidFormatted,
    '\\[Due Date\\]': dueDateFormatted,
    '\\[Invoice Link\\]': invoiceLink,
    '\\[Invoice Number\\]': record?.invoiceNumber || 'Invoice',
    '\\[Deliverable Type\\]': deliverableType,

    '\\{\\{contact_name\\}\\}': contactName,
    '\\{\\{brand_name\\}\\}': brandName,
    '\\{\\{deal_title\\}\\}': dealTitle,
    '\\{\\{deal_amount\\}\\}': totalAmountFormatted,
    '\\{\\{total_amount\\}\\}': totalAmountFormatted,
    '\\{\\{due_amount\\}\\}': dueAmountFormatted,
    '\\{\\{remaining_amount\\}\\}': dueAmountFormatted,
    '\\{\\{amount_paid\\}\\}': amountPaidFormatted,
    '\\{\\{due_date\\}\\}': dueDateFormatted,
    '\\{\\{invoice_link\\}\\}': invoiceLink,
  };

  let result = templateText;
  for (const [pattern, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(pattern, 'gi'), value);
  }

  return result;
}

/**
 * Returns default template text for a trigger type if no custom message template is provided.
 */
export function getDefaultMessageTemplate(triggerType: string): string {
  switch (triggerType) {
    case 'DELIVERABLE_OVERDUE':
      return `Hey [Contact Name], the deliverable for [Brand Name] ([Deal Title]) was due on [Due Date] and is overdue. Please review details here: [Invoice Link]`;

    case 'DELIVERABLE_DUE_SOON':
      return `Hey [Contact Name], you have deliverables for [Brand Name] ([Deal Title]) due on [Due Date]. Please review details here: [Invoice Link]`;

    case 'PAYMENT_DUE_SOON':
      return `Hey [Contact Name], the payment of [Due Amount] for [Brand Name] ([Deal Title]) is due on [Due Date]. Please review details here: [Invoice Link]`;

    case 'PAYMENT_OVERDUE':
      return `Hey [Contact Name], the payment of [Due Amount] for [Brand Name] ([Deal Title]) was due on [Due Date] and is overdue. Please review details here: [Invoice Link]`;

    case 'MISSING_INVOICE':
      return `Hey [Contact Name], the deal for [Brand Name] ([Deal Title]) requires an invoice. Please review details here: [Invoice Link]`;

    default:
      return `Hey [Contact Name], here is an automated update for [Brand Name] ([Deal Title]). Please review details here: [Invoice Link]`;
  }
}

/**
 * Dispatches deal-aggregated emails based on rule recipient configuration:
 * - "me": Sent to rule creator (without message template block).
 * - "primary": Sent to deal/brand primary contact (with interpolated message template).
 * - "all": Sent to all contacts of the deal's brand (with interpolated message template).
 */
async function sendAggregatedEmailNotification(
  rule: ReminderRule,
  result: ReminderProcessingResult
): Promise<boolean> {
  const records = result.records || [];
  if (records.length === 0) return true;

  const rawRecipients = rule.recipients && rule.recipients.length > 0 ? rule.recipients : ['me'];
  const includesMe = rawRecipients.includes('me');
  const includesPrimary = rawRecipients.includes('primary');
  const includesAll = rawRecipients.includes('all');

  const creatorEmail = await getUserEmail(rule.userId);

  // Group records by Deal ID so each deal receives consolidated emails
  const dealsMap = new Map<string, { dealTitle: string; brandName: string; brandId: string; contactId?: string | null; items: any[] }>();

  for (const record of records) {
    const dealKey = record.dealId || record.id || 'general_deal';
    const dealTitle = record.dealTitle || record.title || 'Deal Activity';
    const brandName = record.brandName || 'Brand Partner';
    const brandId = record.brandId || record.deals?.brand_id || '';
    const contactId = record.contactId || record.deals?.contact_id || null;

    if (!dealsMap.has(dealKey)) {
      dealsMap.set(dealKey, { dealTitle, brandName, brandId, contactId, items: [] });
    }
    dealsMap.get(dealKey)!.items.push(record);
  }

  let allSentSuccessfully = true;

  for (const [, dealGroup] of dealsMap.entries()) {

    // 1. RECIPIENT: "me" (Creator of rule — internal reminder without message template block)
    if (includesMe || (!includesPrimary && !includesAll)) {
      if (creatorEmail) {
        const subject = buildDealEmailSubject(rule, dealGroup.dealTitle, dealGroup.brandName, dealGroup.items.length, true);
        const html = buildDealEmailHtml(rule, dealGroup.dealTitle, dealGroup.brandName, dealGroup.items, { isForCreator: true });

        logger.info(
          `[Email Channel] Dispatching CREATOR ("me") email for Deal "${dealGroup.dealTitle}" to ${creatorEmail}...`
        );

        const sent = await sendEmail({ to: creatorEmail, subject, html });
        if (!sent) allSentSuccessfully = false;
      }
    }

    // 2. RECIPIENT: "primary" (Primary contact of the brand — with interpolated message template)
    if (includesPrimary && dealGroup.brandId) {
      const primaryContact = await getPrimaryBrandContact(dealGroup.brandId, dealGroup.contactId);
      if (primaryContact?.email) {
        const subject = buildDealEmailSubject(rule, dealGroup.dealTitle, dealGroup.brandName, dealGroup.items.length, false);
        const html = buildDealEmailHtml(rule, dealGroup.dealTitle, dealGroup.brandName, dealGroup.items, {
          isForCreator: false,
          contactName: primaryContact.name,
        });

        logger.info(
          `[Email Channel] Dispatching PRIMARY CONTACT ("${primaryContact.name}" <${primaryContact.email}>) email for Deal "${dealGroup.dealTitle}"...`
        );

        const sent = await sendEmail({ to: primaryContact.email, subject, html });
        if (!sent) allSentSuccessfully = false;
      } else {
        logger.warn(`[Email Channel] "primary" recipient specified for rule "${rule.name || rule.id}", but no primary contact email found for brand ${dealGroup.brandId}`);
      }
    }

    // 3. RECIPIENT: "all" (All contacts of the brand — with interpolated message template)
    if (includesAll && dealGroup.brandId) {
      const allContacts = await getAllBrandContacts(dealGroup.brandId);
      const validContacts = allContacts.filter((c) => c.email);

      if (validContacts.length > 0) {
        for (const contact of validContacts) {
          const subject = buildDealEmailSubject(rule, dealGroup.dealTitle, dealGroup.brandName, dealGroup.items.length, false);
          const html = buildDealEmailHtml(rule, dealGroup.dealTitle, dealGroup.brandName, dealGroup.items, {
            isForCreator: false,
            contactName: contact.name,
          });

          logger.info(
            `[Email Channel] Dispatching BRAND CONTACT ("${contact.name}" <${contact.email}>) email for Deal "${dealGroup.dealTitle}"...`
          );

          const sent = await sendEmail({ to: contact.email!, subject, html });
          if (!sent) allSentSuccessfully = false;
        }
      } else {
        logger.warn(`[Email Channel] "all" recipients specified for rule "${rule.name || rule.id}", but no contact emails found for brand ${dealGroup.brandId}`);
      }
    }

  }

  return allSentSuccessfully;
}

export function buildDealEmailSubject(
  rule: ReminderRule,
  dealTitle: string,
  brandName: string,
  count: number,
  isForCreator: boolean = false
): string {
  const badge = count > 1 ? `${count} Action Items` : 'Action Required';
  if (isForCreator) {
    return `Reminder: ${dealTitle} (${brandName}) — ${badge}`;
  }
  if (rule.triggerType.includes('PAYMENT')) {
    return `Payment Reminder: ${dealTitle} — ${badge}`;
  }
  return `Reminder: ${dealTitle} — ${badge}`;
}

export function buildDealEmailHtml(
  rule: ReminderRule,
  dealTitle: string,
  brandName: string,
  records: any[],
  options: { isForCreator?: boolean; contactName?: string } = {}
): string {
  const firstRecord = records[0] || {};
  const triggerType = rule.triggerType;

  // Header Title
  let headerTitle = 'Reminder: Action Required';
  let ctaButtonText = 'Review Details';

  if (triggerType.includes('PAYMENT')) {
    headerTitle = 'Payment Reminder';
    ctaButtonText = 'Review Payment Details';
  } else if (triggerType.includes('DELIVERABLE')) {
    headerTitle = 'Deliverable Reminder';
    ctaButtonText = 'Review Deliverable Details';
  } else if (triggerType === 'MISSING_INVOICE') {
    headerTitle = 'Invoice Required';
    ctaButtonText = 'Review Invoice Details';
  }

  // Format Message Block (if not for creator)
  let messageTextBlockHtml = '';
  if (!options.isForCreator) {
    const recordWithContact = {
      ...firstRecord,
      contactName: options.contactName || firstRecord.contactName,
    };
    const rawTemplate = rule.messageTemplate || getDefaultMessageTemplate(triggerType);
    const interpolatedMessage = interpolatePlaceholders(rawTemplate, recordWithContact, dealTitle, brandName, { isHtml: true });

    messageTextBlockHtml = `
      <div style="margin-bottom: 24px; padding: 18px 20px; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 0px;">
        <div style="font-size: 14px; line-height: 1.65; color: #334155; white-space: pre-wrap;">${interpolatedMessage}</div>
      </div>
    `;
  }

  // Stats Grid (Amount Due & Status Badge)
  let statLabel = 'Amount Due';
  let statValue = '$0.00';
  let statSubtext = '';
  let badgeText = 'ACTION REQUIRED';
  let badgeBg = '#FFE4E6';
  let badgeColor = '#9F1239';
  let badgeBorder = '#FECDD3';

  const totalAmt = firstRecord.dealAmount ?? firstRecord.amount;
  const paidAmt = firstRecord.amountPaid ?? 0;
  const dueAmt = firstRecord.dueAmount ?? (totalAmt != null ? Math.max(0, totalAmt - paidAmt) : null);

  const currencyVal = firstRecord.currency || 'USD';
  const symbol = currencyVal === 'INR' ? '₹' : '$';

  const dueAmountFormatted = dueAmt != null
    ? `${symbol}${Number(dueAmt).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '$0.00';

  const totalAmountFormatted = totalAmt != null
    ? `${symbol}${Number(totalAmt).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '$0.00';

  const paidAmountFormatted = `${symbol}${Number(paidAmt).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (triggerType.includes('PAYMENT')) {
    statLabel = 'Amount Due';
    statValue = dueAmountFormatted;
    if (paidAmt > 0 && totalAmt != null) {
      statSubtext = `<div style="font-size: 11px; color: #64748B; margin-top: 3px;">Total: ${totalAmountFormatted} &bull; Paid: ${paidAmountFormatted}</div>`;
    }

    if (triggerType.includes('OVERDUE')) {
      badgeText = firstRecord.paymentStatus ? `OVERDUE (${firstRecord.paymentStatus})` : 'OVERDUE';
      badgeBg = '#FEF2F2';
      badgeColor = '#991B1B';
      badgeBorder = '#FCA5A5';
    } else {
      badgeText = 'PAYMENT DUE';
      badgeBg = '#EFF6FF';
      badgeColor = '#1E40AF';
      badgeBorder = '#BFDBFE';
    }
  } else if (triggerType.includes('DELIVERABLE')) {
    statLabel = 'Pending Items';
    statValue = `${records.length} ${records.length === 1 ? 'Deliverable' : 'Deliverables'}`;

    if (triggerType.includes('OVERDUE')) {
      badgeText = 'OVERDUE DELIVERABLE';
      badgeBg = '#FEF2F2';
      badgeColor = '#991B1B';
      badgeBorder = '#FCA5A5';
    } else {
      badgeText = 'DELIVERABLE DUE SOON';
      badgeBg = '#FFFBEB';
      badgeColor = '#92400E';
      badgeBorder = '#FDE68A';
    }
  } else if (triggerType === 'MISSING_INVOICE') {
    statLabel = 'Invoice Status';
    statValue = 'Missing Invoice';
    badgeText = 'ACTION REQUIRED';
    badgeBg = '#FFFBEB';
    badgeColor = '#92400E';
    badgeBorder = '#FDE68A';
  }

  // Formatting Due Date & Deal URL
  const rawDueDate = firstRecord.dueDate || firstRecord.paymentDueDate;
  const dueDateFormatted = rawDueDate
    ? new Date(rawDueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'Pending';

  const dealId = firstRecord.dealId || firstRecord.id;
  const dealUrl = dealId
    ? `${KORA_APP_URL}/dashboard/deals/${dealId}`
    : `${KORA_APP_URL}/dashboard/deals`;

  const deliverableItemsHtml = triggerType.includes('DELIVERABLE')
    ? `
      <div style="font-size: 12px; font-weight: 700; color: #64748B; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.04em;">DELIVERABLE ITEMS</div>
      ${formatDealItemsHtml(triggerType, records)}
    `
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kora Notification</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0F172A; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F8FAFC; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #FFFFFF; border-radius: 0px; border: 1px solid #E2E8F0; overflow: hidden; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);">
          
          <!-- Content Padding Area -->
          <tr>
            <td style="padding: 36px 36px 28px 36px;">

              <!-- Kora Light Mode Logo Header -->
              <div style="margin-bottom: 24px;">
                <table border="0" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align: middle;">
                      <img src="${KORA_LOGO_LIGHT_MODE}" height="28" alt="Kora" style="display: block; border: 0;" />
                    </td>
                    <td style="vertical-align: middle; padding-left: 8px;">
                      <span style="font-size: 19px; font-weight: 800; color: #0F172A; letter-spacing: 0.05em; line-height: 28px;">KORA</span>
                    </td>
                  </tr>
                </table>
              </div>

              <!-- Main Title Heading -->
              <div style="font-size: 22px; font-weight: 800; color: #0F172A; margin-bottom: 20px; line-height: 1.3; letter-spacing: -0.01em;">
                ${headerTitle}
              </div>

              <!-- Interpolated Message Body (External Contacts) -->
              ${messageTextBlockHtml}

              <!-- Highlight Stats Grid (Amount Due & Status) -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td width="55%" align="left" style="vertical-align: top;">
                    <div style="font-size: 12px; font-weight: 600; color: #64748B; margin-bottom: 4px;">${statLabel}</div>
                    <div style="font-size: 32px; font-weight: 800; color: #0F172A; line-height: 1.1; letter-spacing: -0.02em;">${statValue}</div>
                    ${statSubtext}
                  </td>
                  <td width="45%" align="left" style="vertical-align: top; padding-top: 4px;">
                    <div style="font-size: 12px; font-weight: 600; color: #64748B; margin-bottom: 6px;">Status</div>
                    <span style="display: inline-block; background-color: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 0px; letter-spacing: 0.03em;">
                      &#9888; ${badgeText}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Deal Summary Table Card (Light Mode Theme) -->
              ${options.isForCreator ? `
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border: 1px solid #E2E8F0; border-radius: 0px; background-color: #FFFFFF; overflow: hidden; margin-bottom: 24px;">
                <tr>
                  <td colspan="3" style="padding: 12px 16px; background-color: #FAFAFA; border-bottom: 1px solid #E2E8F0; font-size: 13px; font-weight: 700; color: #0F172A;">
                    Deal Summary
                  </td>
                </tr>
                <tr>
                  <td width="48%" style="padding: 14px 16px; border-right: 1px solid #E2E8F0; vertical-align: top;">
                    <div style="font-size: 11px; font-weight: 600; color: #94A3B8; margin-bottom: 4px;">Project Name</div>
                    <div style="font-size: 13px; font-weight: 700; color: #0F172A; line-height: 1.4;">${dealTitle}</div>
                  </td>
                  <td width="24%" style="padding: 14px 16px; border-right: 1px solid #E2E8F0; vertical-align: top;">
                    <div style="font-size: 11px; font-weight: 600; color: #94A3B8; margin-bottom: 4px;">Brand</div>
                    <div style="font-size: 13px; font-weight: 700; color: #0F172A;">${brandName}</div>
                  </td>
                  <td width="28%" style="padding: 14px 16px; vertical-align: top;">
                    <div style="font-size: 11px; font-weight: 600; color: #94A3B8; margin-bottom: 4px;">Due Date</div>
                    <div style="font-size: 13px; font-weight: 700; color: #0F172A;">${dueDateFormatted}</div>
                  </td>
                </tr>
              </table>
              ` : `
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border: 1px solid #E2E8F0; border-radius: 0px; background-color: #FFFFFF; overflow: hidden; margin-bottom: 24px;">
                <tr>
                  <td colspan="2" style="padding: 12px 16px; background-color: #FAFAFA; border-bottom: 1px solid #E2E8F0; font-size: 13px; font-weight: 700; color: #0F172A;">
                    Deal Summary
                  </td>
                </tr>
                <tr>
                  <td width="65%" style="padding: 14px 16px; border-right: 1px solid #E2E8F0; vertical-align: top;">
                    <div style="font-size: 11px; font-weight: 600; color: #94A3B8; margin-bottom: 4px;">Project Name</div>
                    <div style="font-size: 13px; font-weight: 700; color: #0F172A; line-height: 1.4;">${dealTitle}</div>
                  </td>
                  <td width="35%" style="padding: 14px 16px; vertical-align: top;">
                    <div style="font-size: 11px; font-weight: 600; color: #94A3B8; margin-bottom: 4px;">Due Date</div>
                    <div style="font-size: 13px; font-weight: 700; color: #0F172A;">${dueDateFormatted}</div>
                  </td>
                </tr>
              </table>
              `}

              <!-- Deliverable Line Items (if Deliverable Trigger) -->
              ${deliverableItemsHtml}

              <!-- Primary Action CTA Button (Kora Light Mode Teal Theme - Sharp Edges) -->
              <div style="margin-top: 28px;">
                <a href="${dealUrl}" target="_blank" style="display: block; width: 100%; box-sizing: border-box; text-align: center; background-color: #088395; color: #FFFFFF; font-size: 14px; font-weight: 700; padding: 13px 0; border-radius: 0px; text-decoration: none;">
                  ${ctaButtonText}
                </a>
              </div>

            </td>
          </tr>

          <!-- Light Mode Footer -->
          <tr>
            <td style="padding: 20px 36px; background-color: #FAFAFA; border-top: 1px solid #E2E8F0; text-align: center;">
              <p style="font-size: 12px; color: #64748B; margin: 0 0 4px 0;">
                Sent via <strong>Kora</strong>
              </p>
              <p style="font-size: 11px; color: #94A3B8; margin: 0;">
                &copy; ${new Date().getFullYear()} Kora. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function formatDealItemsHtml(triggerType: string, records: any[]): string {
  if (!records || records.length === 0) {
    return '<p style="font-size: 13px; color: #64748B;">No items recorded.</p>';
  }

  return records.map((record) => {
    let tagBg = '#FFFBEB';
    let tagBorder = '#FDE68A';
    let tagColor = '#92400E';
    let tagText = 'DELIVERABLE';
    let title = record.type || 'Deliverable';
    let detailLines: string[] = [];

    if (triggerType.includes('DELIVERABLE')) {
      if (triggerType.includes('OVERDUE')) {
        tagBg = '#FEF2F2';
        tagBorder = '#FCA5A5';
        tagColor = '#991B1B';
        tagText = 'OVERDUE DELIVERABLE';
      } else {
        tagBg = '#FFFBEB';
        tagBorder = '#FDE68A';
        tagColor = '#92400E';
        tagText = 'DELIVERABLE DUE SOON';
      }
      title = `${record.type || 'Deliverable'}${record.platform ? ` (${record.platform})` : ''}`;
      if (record.dueDate) {
        detailLines.push(`Due Date: <strong style="color: #0F172A;">${new Date(record.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>`);
      }
      if (record.quantity) {
        detailLines.push(`Quantity: <strong style="color: #0F172A;">${record.quantity}</strong>`);
      }
    }

    return `
      <div style="margin-bottom: 12px; padding: 14px 16px; background-color: #FAFAFA; border: 1px solid #E2E8F0; border-radius: 0px;">
        <div style="margin-bottom: 6px;">
          <span style="display: inline-block; background-color: ${tagBg}; color: ${tagColor}; border: 1px solid ${tagBorder}; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 0px; text-transform: uppercase; letter-spacing: 0.04em;">
            ${tagText}
          </span>
        </div>
        <div style="font-size: 13px; font-weight: 700; color: #0F172A; margin-bottom: 4px;">
          ${title}
        </div>
        ${detailLines.length > 0 ? `
          <div style="font-size: 12px; color: #64748B; line-height: 1.4;">
            ${detailLines.join(' &bull; ')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

/**
 * WhatsApp Notification Dispatcher Stub (Kept as TODO stub for integration)
 */
async function processWhatsAppNotificationStub(
  rule: ReminderRule,
  result: ReminderProcessingResult
): Promise<void> {
  const firstRecord = (result.records || [])[0] || {};
  const dealTitle = firstRecord.dealTitle || firstRecord.title || 'Deal';
  const brandName = firstRecord.brandName || 'Brand';
  const brandId = firstRecord.brandId || firstRecord.deals?.brand_id || '';
  const contactId = firstRecord.contactId || firstRecord.deals?.contact_id || null;

  const rawRecipients = rule.recipients && rule.recipients.length > 0 ? rule.recipients : ['me'];

  if (rawRecipients.includes('primary') && brandId) {
    const primaryContact = await getPrimaryBrandContact(brandId, contactId);
    if (primaryContact?.whatsapp) {
      const rawTemplate = rule.messageTemplate || getDefaultMessageTemplate(rule.triggerType);
      const interpolatedMessage = interpolatePlaceholders(rawTemplate, { ...firstRecord, contactName: primaryContact.name }, dealTitle, brandName);

      logger.info(
        `[TODO STUB: WHATSAPP INTEGRATION] WhatsApp to PRIMARY CONTACT ("${primaryContact.name}" <${primaryContact.whatsapp}>) for rule "${rule.name || rule.id}":\n"${interpolatedMessage}"`
      );
    }
  }

  if (rawRecipients.includes('all') && brandId) {
    const allContacts = await getAllBrandContacts(brandId);
    for (const c of allContacts.filter((ct) => ct.whatsapp)) {
      const rawTemplate = rule.messageTemplate || getDefaultMessageTemplate(rule.triggerType);
      const interpolatedMessage = interpolatePlaceholders(rawTemplate, { ...firstRecord, contactName: c.name }, dealTitle, brandName);

      logger.info(
        `[TODO STUB: WHATSAPP INTEGRATION] WhatsApp to BRAND CONTACT ("${c.name}" <${c.whatsapp}>) for rule "${rule.name || rule.id}":\n"${interpolatedMessage}"`
      );
    }
  }

  if (rawRecipients.includes('me')) {
    logger.info(
      `[TODO STUB: WHATSAPP INTEGRATION] WhatsApp internal reminder to CREATOR (User ID: ${rule.userId}) for rule "${rule.name || rule.id}"`
    );
  }
}
