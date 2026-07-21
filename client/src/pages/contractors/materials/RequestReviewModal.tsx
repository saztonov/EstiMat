// Сверка заявки перед созданием.
//
// Один клик по группе стоит сорока строк — финальная сверка обязательна. Построена
// exception-first: сначала строки, требующие внимания (превышение остатка), затем весь список.
// Иначе проблемная строка тонет среди сотен обычных.
import { useMemo, useState } from 'react';
import { Alert, Button, InputNumber, Modal, Space, Switch, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DEFAULT_PAGINATION } from '../../../lib/tableConfig';
import { formatMoney } from '../../estimates/components/types';
import type { OrderMaterialRow } from './orderRow';
import type { DraftState } from './draftFill';
import { remainingOf } from './remaining';

const qty = (v: number) => Math.round(v * 1e4) / 1e4;

export interface ReviewLine {
  row: OrderMaterialRow;
  /** Количество в заявке. */
  value: number;
  /** Уже заявлено по смете. */
  ordered: number;
  /** Остаток до набора. */
  available: number;
  /** Заявляется больше, чем осталось по смете. */
  over: boolean;
}

interface Props {
  open: boolean;
  lines: ReviewLine[];
  submitting: boolean;
  onChange: (orderKey: string, v: number | null) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RequestReviewModal({ open, lines, submitting, onChange, onCancel, onConfirm }: Props) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const issues = useMemo(() => lines.filter((l) => l.over), [lines]);
  const shown = onlyIssues ? issues : lines;
  const total = useMemo(
    () =>
      lines.reduce((s, l) => (l.row.orderUnitPrice == null ? s : s + l.value * l.row.orderUnitPrice), 0),
    [lines],
  );
  const pricedCount = lines.filter((l) => l.row.orderUnitPrice != null).length;

  const columns: ColumnsType<ReviewLine> = [
    {
      title: 'Материал',
      key: 'name',
      render: (_, l) => (
        <Space size={4}>
          <span>{l.row.name}</span>
          {l.over && <Tag color="red">Сверх остатка</Tag>}
        </Space>
      ),
    },
    { title: 'Ед.', key: 'unit', width: 70, render: (_, l) => l.row.unit },
    {
      title: 'По смете',
      key: 'quantity',
      width: 110,
      align: 'right',
      render: (_, l) => qty(l.row.quantity),
    },
    {
      title: 'Уже заявлено',
      key: 'ordered',
      width: 120,
      align: 'right',
      render: (_, l) => (l.ordered > 0 ? qty(l.ordered) : <span style={{ color: '#bfbfbf' }}>—</span>),
    },
    { title: 'Остаток', key: 'available', width: 100, align: 'right', render: (_, l) => qty(l.available) },
    {
      title: 'В заявку',
      key: 'value',
      width: 120,
      align: 'right',
      render: (_, l) => (
        <InputNumber
          min={0}
          size="small"
          style={{ width: 100 }}
          status={l.over ? 'warning' : undefined}
          value={l.value}
          onChange={(v) => onChange(l.row.orderKey, v as number | null)}
        />
      ),
    },
    {
      title: 'После заявки',
      key: 'after',
      width: 120,
      align: 'right',
      render: (_, l) => {
        const left = remainingOf(l.row.quantity, l.ordered + l.value);
        return left > 0 ? qty(left) : <span style={{ color: '#bfbfbf' }}>0</span>;
      },
    },
  ];

  return (
    <Modal
      open={open}
      title="Проверка заявки"
      width={1000}
      onCancel={onCancel}
      okText="Создать заявку"
      cancelText="Вернуться к набору"
      confirmLoading={submitting}
      okButtonProps={{ disabled: lines.length === 0 }}
      onOk={onConfirm}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {issues.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={`Сверх остатка: ${issues.length} поз.`}
            description="Заявляется больше, чем осталось по смете. Это допустимо (запас, отходы), но стоит проверить."
            action={
              !onlyIssues && (
                <Button size="small" onClick={() => setOnlyIssues(true)}>
                  Показать
                </Button>
              )
            }
          />
        )}
        <Space size={12} style={{ flexWrap: 'wrap' }}>
          <span>
            <strong>В заявке:</strong> {lines.length} поз.
            {pricedCount > 0 && ` · ${formatMoney(total)}`}
          </span>
          {pricedCount > 0 && pricedCount < lines.length && (
            <span style={{ color: '#8c8c8c', fontSize: 12 }}>
              оценено {pricedCount} из {lines.length}
            </span>
          )}
          {issues.length > 0 && (
            <Space size={6}>
              <Switch size="small" checked={onlyIssues} onChange={setOnlyIssues} />
              <span style={{ fontSize: 13, color: '#595959' }}>
                Только требующие внимания ({issues.length})
              </span>
            </Space>
          )}
        </Space>
        <Table<ReviewLine>
          rowKey={(l) => l.row.orderKey}
          size="small"
          className="estimat-compact"
          dataSource={shown}
          columns={columns}
          pagination={DEFAULT_PAGINATION}
          scroll={{ x: 900, y: 420 }}
        />
      </Space>
    </Modal>
  );
}

/** Строки сверки из черновика: обходим полный свод, а не видимое дерево. */
export function buildReviewLines(
  rows: OrderMaterialRow[],
  draft: DraftState,
  ordered: Map<string, number>,
): ReviewLine[] {
  const out: ReviewLine[] = [];
  for (const row of rows) {
    const value = draft.values.get(row.orderKey);
    if (value == null) continue;
    const already = ordered.get(row.orderKey) ?? 0;
    const available = remainingOf(row.quantity, already);
    out.push({ row, value, ordered: already, available, over: value > available + 1e-6 });
  }
  return out;
}
