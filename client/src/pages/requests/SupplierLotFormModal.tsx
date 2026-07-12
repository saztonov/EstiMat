import { useMemo, useState } from 'react';
import { Modal, Radio, Select, Input, Table, InputNumber, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { round4 } from './requestConstants';
import type { Su10MaterialRow, SupplierLotRow } from './types';

interface Props {
  open: boolean;
  projectId: string;
  rows: Su10MaterialRow[]; // выбранные позиции свода (remaining > 0)
  onClose: () => void;
  onDone: () => void;
}

interface DraftItem {
  requestItemId: string;
  name: string;
  unit: string;
  contractor: string;
  requestNo: number | null;
  remaining: number;
  quantity: number;
}

export function SupplierLotFormModal({ open, projectId, rows, onClose, onDone }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [title, setTitle] = useState('');
  const [orderId, setOrderId] = useState<string | undefined>();
  const [draft, setDraft] = useState<Map<string, number>>(new Map());

  // Формируемые лоты объекта (для режима «добавить в существующий»).
  const lotsQ = useQuery({
    queryKey: ['supplier-lots', 'forming', projectId],
    queryFn: () => api.get<{ data: SupplierLotRow[] }>(`/supplier-orders?projectId=${projectId}&status=forming`),
    enabled: open,
  });

  const items = useMemo<DraftItem[]>(
    () =>
      rows.map((r) => ({
        requestItemId: r.request_item_id,
        name: r.material_name,
        unit: r.unit,
        contractor: r.contractor_name ?? '—',
        requestNo: r.request_no,
        remaining: r.remaining,
        quantity: draft.get(r.request_item_id) ?? r.remaining,
      })),
    [rows, draft],
  );

  const submit = useMutation({
    mutationFn: () =>
      api.post<{ data: { id: string; orderNo: number } }>('/supplier-orders', {
        projectId,
        orderId: mode === 'existing' ? orderId : undefined,
        title: mode === 'new' ? title.trim() || undefined : undefined,
        clientRequestId: crypto.randomUUID(),
        items: items.map((it) => ({ requestItemId: it.requestItemId, quantity: it.quantity })),
      }),
    onSuccess: (res) => {
      message.success(`Материалы добавлены в лот № Л-${String(res?.data?.orderNo ?? 0).padStart(3, '0')}`);
      queryClient.invalidateQueries({ queryKey: ['su10-materials'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-lots'] });
      onDone();
    },
    onError: (e: Error) => message.error(e.message),
  });

  function onOk() {
    if (mode === 'existing' && !orderId) return message.warning('Выберите лот');
    if (items.some((it) => it.quantity <= 0 || it.quantity > it.remaining + 1e-9)) {
      return message.warning('Количество должно быть в пределах остатка');
    }
    submit.mutate();
  }

  const columns: ColumnsType<DraftItem> = [
    { title: 'Материал', dataIndex: 'name', key: 'name' },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
    { title: 'Подрядчик', dataIndex: 'contractor', key: 'contractor', width: 160 },
    { title: 'Остаток', dataIndex: 'remaining', key: 'remaining', width: 90, align: 'right', render: (v: number) => round4(v) },
    {
      title: 'В лот', key: 'qty', width: 120, align: 'right',
      render: (_, it) => (
        <InputNumber
          min={0}
          max={it.remaining}
          value={it.quantity}
          style={{ width: 100 }}
          onChange={(v) => setDraft((prev) => new Map(prev).set(it.requestItemId, Number(v ?? 0)))}
        />
      ),
    },
  ];

  return (
    <Modal
      open={open}
      title="Заказ поставщику — формирование лота"
      onCancel={onClose}
      onOk={onOk}
      okText="Добавить в лот"
      confirmLoading={submit.isPending}
      width={760}
    >
      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        style={{ marginBottom: 12 }}
        options={[
          { value: 'new', label: 'Новый лот' },
          { value: 'existing', label: 'Добавить в существующий' },
        ]}
        optionType="button"
      />
      {mode === 'new' ? (
        <Input
          placeholder="Название лота (необязательно)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ marginBottom: 12 }}
        />
      ) : (
        <Select
          placeholder="Выберите формируемый лот"
          style={{ width: '100%', marginBottom: 12 }}
          value={orderId}
          onChange={setOrderId}
          loading={lotsQ.isLoading}
          options={(lotsQ.data?.data ?? []).map((l) => ({
            value: l.id,
            label: `Л-${String(l.order_no ?? 0).padStart(3, '0')}${l.title ? ` · ${l.title}` : ''} (${l.items_count} поз.)`,
          }))}
          notFoundContent="Формируемых лотов нет"
        />
      )}
      <Table<DraftItem>
        rowKey="requestItemId"
        size="small"
        pagination={false}
        dataSource={items}
        columns={columns}
        scroll={{ y: 320 }}
      />
    </Modal>
  );
}
