import nodemailer from 'nodemailer';
import { logger } from './logger';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user) {
    logger.warn('Nodemailer: SMTP credentials (SMTP_HOST / SMTP_USER) not set in environment. Email will be logged to console.');
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    });
  }

  return transporter;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const from = process.env.EMAIL_FROM || '"Kora Reminders" <reminders@kora.moamir.cloud>';
  const recipients = Array.isArray(options.to) ? options.to : [options.to];

  if (recipients.length === 0) {
    logger.warn('Nodemailer: No recipients provided for email.');
    return false;
  }

  const transport = getTransporter();

  if (!transport) {
    logger.info(`[NODEMAILER LOG ONLY] To: ${recipients.join(', ')} | Subject: "${options.subject}"`);
    return true;
  }

  try {
    const info = await transport.sendMail({
      from,
      to: recipients.join(', '),
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    logger.info(`Nodemailer: Email sent successfully to ${recipients.join(', ')} (Message ID: ${info.messageId})`);
    return true;
  } catch (error) {
    logger.error(`Nodemailer Error: Failed to send email to ${recipients.join(', ')}:`, error);
    return false;
  }
}

export function closeTransporter(): void {
  if (transporter) {
    transporter.close();
    transporter = null;
  }
}
