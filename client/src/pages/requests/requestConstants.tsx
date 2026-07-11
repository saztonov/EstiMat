import { Tag, Tooltip } from 'antd';
import {
  REQUEST_STATUS_LABELS,
  MATERIAL_REQUEST_TYPE_LABELS,
  type RequestStatus,
  type MaterialRequestType,
} from '@estimat/shared';

// Цвета тегов статуса/вида (клиентская палитра).
const STATUS_COLOR: Record<RequestStatus, string> = {
  in_work: 'processing',
  revision: 'warning',
  supplier_selected: 'blue',
  paid: 'green',
  delivered: 'success',
};

const TYPE_COLOR: Record<string, string> = {
  own_supplier: 'geekblue',
  su10: 'purple',
  own_supply: 'cyan',
};

export function money(v: number | string | null | undefined): string {
  if (v == null || v === '') return '—';
  return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function round4(v: number | string | null | undefined): number {
  return Math.round(Number(v ?? 0) * 1e4) / 1e4;
}

export function RequestStatusTag({ status, comment }: { status: RequestStatus; comment?: string | null }) {
  const label = REQUEST_STATUS_LABELS[status] ?? status;
  const tag = <Tag color={STATUS_COLOR[status] ?? 'default'}>{label}</Tag>;
  return status === 'revision' && comment ? <Tooltip title={comment}>{tag}</Tooltip> : tag;
}

export function RequestTypeTag({ type }: { type: string }) {
  const label = MATERIAL_REQUEST_TYPE_LABELS[type as MaterialRequestType] ?? type;
  return <Tag color={TYPE_COLOR[type] ?? 'default'}>{label}</Tag>;
}
