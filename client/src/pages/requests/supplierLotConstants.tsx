import { Tag } from 'antd';
import {
  SOURCING_STATUS_LABELS,
  PROCUREMENT_METHOD_LABELS,
  TENDER_STATUS_LABELS,
  type SourcingStatus,
  type ProcurementMethod,
  type TenderStatus,
} from '@estimat/shared';

const SOURCING_COLOR: Record<string, string> = {
  forming: 'default',
  sourcing: 'processing',
  awarded: 'green',
  cancel_pending: 'warning',
  cancelled: 'default',
};

const TENDER_COLOR: Record<string, string> = {
  draft: 'default',
  published: 'processing',
  awaiting_results: 'gold',
  finished: 'green',
  cancelled: 'default',
};

export function SourcingStatusTag({ status }: { status: string }) {
  const label = SOURCING_STATUS_LABELS[status as SourcingStatus] ?? status;
  return <Tag color={SOURCING_COLOR[status] ?? 'default'}>{label}</Tag>;
}

export function ProcurementMethodTag({ method }: { method: string | null }) {
  if (!method) return <span style={{ color: '#bfbfbf' }}>—</span>;
  const label = PROCUREMENT_METHOD_LABELS[method as ProcurementMethod] ?? method;
  return <Tag color={method === 'tender' ? 'blue' : 'cyan'}>{label}</Tag>;
}

export function TenderStatusTag({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: '#bfbfbf' }}>—</span>;
  const label = TENDER_STATUS_LABELS[status as TenderStatus] ?? status;
  return <Tag color={TENDER_COLOR[status] ?? 'default'}>{label}</Tag>;
}
