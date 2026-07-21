export type ReminderTriggerType =
  | 'DELIVERABLE_DUE_SOON'
  | 'DELIVERABLE_OVERDUE'
  | 'PAYMENT_DUE'
  | 'PAYMENT_OVERDUE'
  | 'MISSING_INVOICE';

export type OffsetUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months';

export type ReminderExecutionStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'PENDING';

export interface ReminderRule {
  id: string;
  userId: string;
  templateId?: string | null;
  name?: string | null;
  triggerType: ReminderTriggerType;
  offsetValue: number;
  offsetUnit: string;
  recipients?: string[];
  messageTemplate?: string | null;
  channelEmail?: boolean;
  channelWhatsapp?: boolean;
  channelPush?: boolean;
  isActive: boolean;
  lastTriggeredAt?: string | null;
  createdAt?: string;
}

export interface DeliverableRecord {
  id: string;
  dealId: string;
  type: string;
  quantity: number;
  platform: string | null;
  dueDate: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  dealTitle?: string | null;
  brandName?: string | null;
}

export interface DealRecord {
  id: string;
  userId: string;
  brandId: string;
  contactId?: string | null;
  title: string;
  stage: string;
  amount: number | null;
  currency: string;
  paymentTerms?: string | null;
  paymentDueDate: string | null;
  paymentStatus: string;
  amountPaid: number;
  createdAt: string;
  dealTitle?: string | null;
  brandName?: string | null;
}

export interface InvoiceRecord {
  id: string;
  userId: string;
  dealId: string;
  invoiceNumber: string;
  status: string;
  total: number;
  issuedDate: string;
  dueDate: string;
  paidAt: string | null;
}

export interface ReminderWindow {
  startDate: Date;
  endDate: Date;
}

export interface ReminderProcessingResult<T = any> {
  ruleId: string;
  triggerType: ReminderTriggerType;
  window: ReminderWindow | null;
  count: number;
  durationMs: number;
  records: T[];
}
