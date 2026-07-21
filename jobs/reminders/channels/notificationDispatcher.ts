import { logger } from '../../../lib/logger';
import { sendEmail } from '../../../lib/email';
import { ReminderRule, ReminderProcessingResult } from '../types';
import { getUserEmail, createReminderRuleLog, updateReminderRuleLastTriggeredAt } from '../repository';

export async function dispatchNotifications(
  rule: ReminderRule,
  result: ReminderProcessingResult
): Promise<void> {
  const startedAt = new Date();

  if (result.count === 0) {
    logger.info(`[Notification Dispatcher] Rule "${rule.name || rule.id}": 0 matching events. Skipping notifications.`);
    return;
  }

  logger.info(`[Notification Dispatcher] Processing notifications for rule "${rule.name || rule.id}" (${result.count} events matched)`);

  // Resolve target email recipients (replaces 'me' with user's registered email address)
  const recipients = await resolveRecipients(rule);

  try {
    // 1. EMAIL CHANNEL
    if (rule.channelEmail) {
      if (recipients.length === 0) {
        throw new Error(`Email channel enabled for rule "${rule.name || rule.id}", but could not resolve any valid email address for user ${rule.userId}.`);
      }

      const emailSentSuccessfully = await sendAggregatedEmailNotification(rule, result, recipients);
      if (!emailSentSuccessfully) {
        throw new Error(`Failed to send email to recipients: ${recipients.join(', ')}`);
      }
    } else {
      logger.info(`[Email Channel] Rule "${rule.name || rule.id}": Disabled in rule configuration. Skipping.`);
    }

    // 2. WHATSAPP CHANNEL (TODO STUB)
    if (rule.channelWhatsapp) {
      processWhatsAppNotificationStub(rule, result);
    }

    const completedAt = new Date();

    // Record SUCCESS in reminder_rule_logs table
    await createReminderRuleLog({
      reminderRuleId: rule.id,
      status: 'SUCCESS',
      startedAt,
      completedAt,
    });

    // Update last_triggered_at on the reminder_rules table
    await updateReminderRuleLastTriggeredAt(rule.id, completedAt);

  } catch (error: any) {
    logger.error(`[Notification Dispatcher] Error dispatching notifications for rule "${rule.name || rule.id}":`, error);

    // Record FAILED in reminder_rule_logs table
    await createReminderRuleLog({
      reminderRuleId: rule.id,
      status: 'FAILED',
      startedAt,
      completedAt: new Date(),
      errorMessage: error?.message || String(error),
    });
  }
}

export async function resolveRecipients(rule: ReminderRule): Promise<string[]> {
  let userEmail: string | null = null;
  const resolvedRecipients: string[] = [];

  const rawRecipients = rule.recipients && rule.recipients.length > 0
    ? rule.recipients
    : ['me'];

  for (const recipient of rawRecipients) {
    const trimmed = recipient.trim();
    if (trimmed.toLowerCase() === 'me') {
      if (!userEmail) {
        userEmail = await getUserEmail(rule.userId);
      }
      if (userEmail && !resolvedRecipients.includes(userEmail)) {
        resolvedRecipients.push(userEmail);
      }
    } else if (trimmed.includes('@')) {
      if (!resolvedRecipients.includes(trimmed)) {
        resolvedRecipients.push(trimmed);
      }
    }
  }

  // Fallback: If no email was resolved, fetch the rule owner's email directly
  if (resolvedRecipients.length === 0) {
    if (!userEmail) {
      userEmail = await getUserEmail(rule.userId);
    }
    if (userEmail) {
      resolvedRecipients.push(userEmail);
    }
  }

  return resolvedRecipients;
}

/**
 * Groups matched items by Deal ID and sends ONLY ONE email per Deal.
 */
async function sendAggregatedEmailNotification(
  rule: ReminderRule,
  result: ReminderProcessingResult,
  recipients: string[]
): Promise<boolean> {
  const records = result.records || [];
  if (records.length === 0) return true;

  // Group records by Deal ID so each deal receives only 1 consolidated email
  const dealsMap = new Map<string, { dealTitle: string; brandName: string; items: any[] }>();

  for (const record of records) {
    const dealKey = record.dealId || record.id || 'general_deal';
    const dealTitle = record.dealTitle || record.title || 'Deal Activity';
    const brandName = record.brandName || 'Brand Partner';

    if (!dealsMap.has(dealKey)) {
      dealsMap.set(dealKey, { dealTitle, brandName, items: [] });
    }
    dealsMap.get(dealKey)!.items.push(record);
  }

  let allSentSuccessfully = true;

  // Send 1 aggregated email per Deal
  for (const [dealId, dealGroup] of dealsMap.entries()) {
    const subject = buildDealEmailSubject(rule, dealGroup.dealTitle, dealGroup.brandName, dealGroup.items.length);
    const html = buildDealEmailHtml(rule, dealGroup.dealTitle, dealGroup.brandName, dealGroup.items);

    logger.info(
      `[Email Channel] Sending 1 deal-aggregated email for Deal "${dealGroup.dealTitle}" (${dealGroup.brandName}) to ${recipients.join(', ')} listing ${dealGroup.items.length} items...`
    );

    const sent = await sendEmail({
      to: recipients,
      subject,
      html,
    });

    if (!sent) {
      allSentSuccessfully = false;
    }
  }

  return allSentSuccessfully;
}

export function buildDealEmailSubject(
  rule: ReminderRule,
  dealTitle: string,
  brandName: string,
  count: number
): string {
  const badge = count > 1 ? `${count} Action Items` : 'Action Required';
  return `Reminder: ${dealTitle} (${brandName}) — ${badge}`;
}

export function buildDealEmailHtml(
  rule: ReminderRule,
  dealTitle: string,
  brandName: string,
  records: any[]
): string {
  const ruleTitle = rule.name || `Reminder (${rule.triggerType})`;
  const itemsHtml = formatDealItemsHtml(rule.triggerType, records);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kora Scheduled Reminder</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #f1f5f9;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="left" style="vertical-align: middle;">
                    <div style="display: inline-block; background-color: #4f46e5; color: #ffffff; font-weight: 800; font-size: 16px; width: 32px; height: 32px; line-height: 32px; text-align: center; border-radius: 8px; vertical-align: middle; margin-right: 10px;">K</div>
                    <span style="font-size: 18px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em; vertical-align: middle;">KORA</span>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <span style="display: inline-block; background-color: #eef2ff; color: #4338ca; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 20px; border: 1px solid #c7d2fe;">${records.length} ${records.length === 1 ? 'Item' : 'Items'}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px;">
              <!-- Deal Banner Card -->
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #4f46e5; border-radius: 8px; padding: 20px; margin-bottom: 28px;">
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 6px;">Deal Summary</div>
                <div style="font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 8px; line-height: 1.3;">${dealTitle}</div>
                <div>
                  <span style="display: inline-block; background-color: #ffffff; color: #334155; font-size: 13px; font-weight: 600; padding: 3px 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-right: 8px;">Brand: ${brandName}</span>
                  <span style="display: inline-block; color: #64748b; font-size: 13px;">Rule: <strong>${ruleTitle}</strong></span>
                </div>
              </div>

              <!-- Action Items Header -->
              <div style="font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.05em;">Pending Action Items</div>

              <!-- List of Items -->
              ${itemsHtml}

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center;">
              <p style="font-size: 12px; color: #94a3b8; margin: 0 0 6px 0;">
                Automated update sent from your Kora Workspace.
              </p>
              <p style="font-size: 11px; color: #cbd5e1; margin: 0;">
                &copy; ${new Date().getFullYear()} Kora Platform Inc. All rights reserved.
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
    return '<p style="font-size: 14px; color: #64748b;">No items recorded.</p>';
  }

  return records.map((record) => {
    let tagBg = '#EEF2FF';
    let tagColor = '#4338CA';
    let tagText = 'DELIVERABLE';
    let title = record.type || 'Deliverable';
    let detailLines: string[] = [];

    if (triggerType.includes('DELIVERABLE')) {
      tagBg = '#EEF2FF';
      tagColor = '#4338CA';
      tagText = triggerType.includes('OVERDUE') ? 'OVERDUE DELIVERABLE' : 'DELIVERABLE';
      title = `${record.type || 'Deliverable'} (${record.platform || 'General'})`;
      if (record.dueDate) {
        detailLines.push(`Due Date: <strong>${new Date(record.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>`);
      }
      if (record.quantity) {
        detailLines.push(`Quantity: <strong>${record.quantity}</strong>`);
      }
    } else if (triggerType.includes('PAYMENT')) {
      tagBg = '#ECFDF5';
      tagColor = '#047857';
      tagText = triggerType.includes('OVERDUE') ? 'OVERDUE PAYMENT' : 'PAYMENT DUE';
      title = `Payment Amount: ${record.currency || 'USD'} ${record.amount ? record.amount.toLocaleString() : '0'}`;
      if (record.paymentDueDate) {
        detailLines.push(`Due Date: <strong>${new Date(record.paymentDueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>`);
      }
      if (record.paymentStatus) {
        detailLines.push(`Status: <strong>${record.paymentStatus}</strong>`);
      }
    } else if (triggerType === 'MISSING_INVOICE') {
      tagBg = '#FEF3C7';
      tagColor = '#B45309';
      tagText = 'MISSING INVOICE';
      title = `Deal Stage: ${record.stage || 'Active'}`;
      detailLines.push(`Action Required: <strong>Create & send invoice</strong>`);
    }

    return `
      <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin-bottom: 12px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.02);">
        <table width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="left" style="vertical-align: top;">
              <span style="display: inline-block; background-color: ${tagBg}; color: ${tagColor}; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; letter-spacing: 0.03em; margin-bottom: 8px;">${tagText}</span>
              <div style="font-size: 15px; font-weight: 600; color: #0f172a; margin-bottom: 4px;">${title}</div>
              <div style="font-size: 13px; color: #475569; line-height: 1.5;">${detailLines.join(' &bull; ')}</div>
            </td>
          </tr>
        </table>
      </div>
    `;
  }).join('');
}

function processWhatsAppNotificationStub(
  rule: ReminderRule,
  result: ReminderProcessingResult
): Promise<void> {
  // TODO: Implement WhatsApp Channel Integration (e.g. Twilio / Meta WhatsApp Business API)
  logger.info(
    `[TODO: WHATSAPP CHANNEL] WhatsApp channel enabled for rule "${rule.name || rule.id}". ` +
    `TODO STUB: Prepare and send WhatsApp message for ${result.count} matched events to user ${rule.userId}.`
  );
  return Promise.resolve();
}
