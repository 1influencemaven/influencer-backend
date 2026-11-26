export type DashboardAttentionType =
  | 'IBP_DRAFT'
  | 'IBP_FAILED'
  | 'BRANDS_UNDER_REVIEW'
  | 'APPROVED_NO_CONTACTS'
  | 'DISCOVERY_FAILED'
  | 'EMAIL_DISCONNECTED';

export type DashboardAttentionItem = {
  id: string;
  type: DashboardAttentionType;
  title: string;
  count: number;
  href: string;
  entityId?: string;
  entityLabel?: string;
};

export type DashboardMetrics = {
  talentsActiveIbp: number;
  talentsNeedingIbp: number;
  brandsUnderReview: number;
  approvedWithoutContacts: number;
  readyContacts: number;
  emailAccountsConnected: number | null;
  emailAccountsDisconnected: number | null;
};

export type DashboardStatsResponse = {
  metrics: DashboardMetrics;
  attention: DashboardAttentionItem[];
};
