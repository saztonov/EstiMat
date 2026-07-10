import type { RequestStatus } from '@estimat/shared';

export interface RequestItem {
  name: string;
  unit: string;
  quantity: number | string;
  cost_type_name: string | null;
}

export interface RequestFile {
  id: string;
  doc_type: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

export interface RequestOrder {
  id: string;
  supplier_name: string;
  supplier_inn: string | null;
  amount: string | number;
  rp_number: string | null;
  rp_date: string | null;
  created_at: string;
}

export interface RequestPayment {
  id: string;
  amount: string | number;
  paid_at: string | null;
  doc_number: string | null;
  comment: string | null;
  created_at: string;
}

export interface RequestRevision {
  id: string;
  reason: string;
  response: string | null;
  requested_at: string;
  completed_at: string | null;
  requested_by_name: string | null;
  completed_by_name: string | null;
}

export interface RequestHistoryEntry {
  action: string;
  changes: Record<string, unknown> | null;
  created_at: string;
  actor_name: string | null;
}

export interface RequestRow {
  id: string;
  number: string;
  request_no: number | null;
  request_type: string;
  status: RequestStatus;
  created_at: string;
  row_version: number;
  contractor_name: string | null;
  contractor_inn: string | null;
  project_name: string | null;
  project_code: string | null;
  supplier_name: string | null;
  supplier_inn: string | null;
  order_amount: string | number | null;
  rp_number: string | null;
  files_count: number | string;
  items_count: number | string;
  revision_reason: string | null;
}

export interface RequestDetail extends RequestRow {
  estimate_label: string | null;
  items: RequestItem[];
  files: RequestFile[];
  order: RequestOrder | null;
  payments: RequestPayment[];
  revisions: RequestRevision[];
  history: RequestHistoryEntry[];
}
