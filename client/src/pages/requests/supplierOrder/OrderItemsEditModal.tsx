import { useState } from 'react';
import { Modal, Table, InputNumber, Input, Space, Typography, Alert, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../../../services/api';
import { modalWidth } from '../../../lib/modalWidth';
import { round4 } from '../requestConstants';
import type { SupplierOrderDetail, SupplierLotItem } from '../types';

const { Text } = Typography;

/**
 * Правка объёмов позиций заказа. Меняются только количества: добавление материалов идёт через
 * формирование заказа, а удаление — отдельной кнопкой в составе.
 *
 * График подгоняется сервером автоматически (уменьшение списывается с поздних дат), поэтому здесь
 * его не спрашиваем — иначе окно превратилось бы во второй редактор графика.
 */
export function OrderItemsEditModal({ order, onClose, onSaved }: {
  order: SupplierOrderDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<Record<string, number>>(
    () => Object.fromEntries(order.items.map((i) => [i.id, Number(i.quantity)])),
  );
  const [reason, setReason] = useState('');

  const changed = order.items.filter((i) => Number(draft[i.id] ?? i.quantity) !== Number(i.quantity));
  const awarded = order.sourcing_status === 'awarded';

  const save = useMutation({
    mutationFn: async () => {
      // Позиции правятся по одной: у каждой свой остаток по заявке, и общий батч скрыл бы, какая
      // именно строка не прошла проверку.
      for (const it of changed) {
        await api.patch(`/supplier-orders/${order.id}/items/${it.id}`, {
          quantity: Number(draft[it.id]),
          reason: reason.trim() || undefined,
        });
      }
    },
    onSuccess: () => {
      message.success(changed.length === 1 ? 'Объём изменён' : 'Объёмы изменены');
      onSaved();
      onClose();
    },
    onError: (e: Error) => {
      message.error(e instanceof ApiError ? e.message : 'Не удалось сохранить');
    },
  });

  const cols: ColumnsType<SupplierLotItem> = [
    { title: 'Материал', dataIndex: 'material_name', key: 'm' },
    { title: 'Ед.', dataIndex: 'unit', key: 'u', width: 70 },
    {
      title: 'Дата поставки', dataIndex: 'delivery_date', key: 'd', width: 120,
      render: (v: string | null) => { if (!v) return '—'; const [y, m, dd] = v.split('-'); return `${dd}.${m}.${y}`; },
    },
    { title: 'Было', dataIndex: 'quantity', key: 'was', width: 90, align: 'right', render: (v) => round4(v) },
    {
      title: 'Стало', key: 'now', width: 130, align: 'right',
      render: (_, it) => (
        <InputNumber
          min={0.0001} precision={4} style={{ width: 120 }}
          value={draft[it.id]}
          onChange={(v) => setDraft((d) => ({ ...d, [it.id]: Number(v ?? 0) }))}
        />
      ),
    },
  ];

  return (
    <Modal
      open title="Объёмы заказа" width={modalWidth(860)}
      onCancel={onClose} onOk={() => {
        if (!changed.length) return message.warning('Изменений нет');
        save.mutate();
      }}
      okText="Сохранить" confirmLoading={save.isPending}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {awarded && (
          <Alert
            type="warning" showIcon
            message="Заказ уже присуждён"
            description="После изменения объёмов сумма пересчитается, и к заказу нужно будет приложить новый счёт."
          />
        )}
        <Text type="secondary">
          Увеличить объём можно только в пределах остатка по заявкам. Заказать больше заявленного нельзя.
        </Text>
        <Table<SupplierLotItem>
          rowKey="id" size="small" pagination={false} dataSource={order.items} columns={cols} scroll={{ x: 620 }}
        />
        <Input.TextArea
          value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Причина изменения (необязательно)" autoSize={{ minRows: 2, maxRows: 4 }} maxLength={2000}
        />
      </Space>
    </Modal>
  );
}
