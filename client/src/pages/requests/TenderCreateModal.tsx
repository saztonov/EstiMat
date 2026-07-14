import { useMemo, useState } from 'react';
import { Modal, Table, InputNumber, Form, DatePicker, Input, Select, Collapse, Alert, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TENDER_VAT_RATES, TENDER_VAT_RATE_LABELS } from '@estimat/shared';
import { api } from '../../services/api';
import { round4 } from './requestConstants';
import type { Su10MaterialRow } from './types';

interface Props {
  projectId: string;
  rows: Su10MaterialRow[];
  onClose: () => void;
  onDone: () => void;
}

/** «Тендер» из свода материалов: количества (частично из нескольких заявок) + условия → создать заказ и выгрузить тендер. */
export function TenderCreateModal({ projectId, rows, onClose, onDone }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [draft, setDraft] = useState<Map<string, number>>(new Map());

  const items = useMemo(
    () => rows.map((r) => ({
      requestItemId: r.request_item_id, name: r.material_name, unit: r.unit,
      remaining: r.remaining ?? 0, quantity: draft.get(r.request_item_id) ?? (r.remaining ?? 0),
    })),
    [rows, draft],
  );

  const submit = useMutation({
    mutationFn: async (v: { deadlineAt: string; vatRate: string; place?: string; delivery?: string; payment?: string; deadline?: string }) => {
      const created = await api.post<{ data: { id: string; rowVersion: number } }>('/supplier-orders', {
        projectId, clientRequestId: crypto.randomUUID(),
        items: items.map((it) => ({ requestItemId: it.requestItemId, quantity: it.quantity })),
      });
      await api.post(`/supplier-orders/${created.data.id}/tender`, {
        method: 'tender', expectedVersion: created.data.rowVersion,
        tender: {
          deadlineAt: v.deadlineAt, vatRate: v.vatRate ?? 'vat20',
          place: v.place || null, delivery: v.delivery || null, payment: v.payment || null, deadline: v.deadline || null,
        },
      });
    },
    onSuccess: () => {
      message.success('Тендер поставлен в очередь на выгрузку в портал');
      qc.invalidateQueries({ queryKey: ['su10-materials'] });
      qc.invalidateQueries({ queryKey: ['purchases-registry'] });
      qc.invalidateQueries({ queryKey: ['supplier-lots'] });
      onDone();
    },
    onError: (e: Error) => message.error(e.message),
  });

  function onOk() {
    if (items.some((it) => it.quantity <= 0 || it.quantity > it.remaining + 1e-9)) {
      return message.warning('Количество должно быть в пределах остатка');
    }
    form.validateFields().then((v) => submit.mutate({ ...v, deadlineAt: v.deadlineAt.toISOString() }));
  }

  const columns: ColumnsType<(typeof items)[number]> = [
    { title: 'Материал', dataIndex: 'name', key: 'name' },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
    { title: 'Остаток', dataIndex: 'remaining', key: 'rem', width: 90, align: 'right', render: (v: number) => round4(v) },
    {
      title: 'В тендер', key: 'qty', width: 120, align: 'right',
      render: (_, it) => <InputNumber min={0} max={it.remaining} value={it.quantity} style={{ width: 100 }}
        onChange={(v) => setDraft((prev) => new Map(prev).set(it.requestItemId, Number(v ?? 0)))} />,
    },
  ];

  return (
    <Modal open title="Тендер на поставку материалов" width={780} onCancel={onClose} onOk={onOk} okText="Выгрузить в портал" confirmLoading={submit.isPending}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Тендер публикуется на портале сразу — приём предложений начнётся немедленно." />
      <Table rowKey="requestItemId" size="small" pagination={false} dataSource={items} columns={columns} scroll={{ y: 220 }} style={{ marginBottom: 12 }} />
      <Form form={form} layout="vertical" initialValues={{ vatRate: 'vat20' }}>
        <Form.Item name="deadlineAt" label="Дедлайн приёма ставок" rules={[{ required: true, message: 'Укажите дедлайн приёма ставок' }]}>
          <DatePicker showTime style={{ width: '100%' }} disabledDate={(d) => !!d && d.endOf('day').valueOf() < Date.now()} />
        </Form.Item>
        <Form.Item name="place" label="Место поставки"><Input /></Form.Item>
        <Collapse ghost items={[{
          key: 'more', label: 'Дополнительно',
          children: (
            <>
              <Form.Item name="vatRate" label="Ставка НДС">
                <Select options={TENDER_VAT_RATES.map((r) => ({ value: r, label: TENDER_VAT_RATE_LABELS[r] }))} />
              </Form.Item>
              <Form.Item name="delivery" label="Условия поставки"><Input /></Form.Item>
              <Form.Item name="payment" label="Условия оплаты"><Input /></Form.Item>
              <Form.Item name="deadline" label="Срок поставки"><Input /></Form.Item>
            </>
          ),
        }]} />
      </Form>
    </Modal>
  );
}
