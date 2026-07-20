import { useMemo, useState } from 'react';
import { Modal, Table, InputNumber, Form, Input, Typography, Tag, Space, Alert, App } from 'antd';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import { ROW_HIGHLIGHTS } from '../../lib/rowHighlights';
import { round4 } from './requestConstants';
import type { RequestItem } from './types';

const { Text } = Typography;

/**
 * Правка объёмов позиций заявки снабжением.
 *
 * Показываем ВСЕ позиции, а не только незаказанные: объём разрешено опускать ниже уже
 * размещённого в заказах, поэтому скрывать такие строки было бы неверно — их как раз и правят
 * осознанно, с подтверждением.
 *
 * Меняются только количества; добавление и удаление материалов остаются за циклом доработки.
 */
interface Props {
  requestId: string;
  requestType: string;
  items: RequestItem[];
  rowVersion: number;
  onClose: () => void;
  onSaved: () => void;
}

interface OverplacedItem {
  itemId: string;
  name: string;
  placed: number;
  frozenPlaced: number;
  newQuantity: number | string;
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

export function RequestItemsEditModal({ requestId, requestType, items, rowVersion, onClose, onSaved }: Props) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<{ comment: string }>();
  const [draft, setDraft] = useState<Record<string, number>>(
    () => Object.fromEntries(items.map((i) => [i.id, Number(i.quantity)])),
  );
  const [busy, setBusy] = useState(false);

  const isSu10 = requestType === 'su10';
  const changed = useMemo(
    () => items.filter((i) => Number(draft[i.id] ?? i.quantity) !== Number(i.quantity)),
    [items, draft],
  );
  const belowPlaced = useMemo(
    () => items.filter((i) => Number(draft[i.id] ?? i.quantity) < Number(i.placed ?? 0)),
    [items, draft],
  );

  async function submit(acknowledge = false) {
    const v = await form.validateFields();
    if (changed.length === 0) { message.warning('Изменений нет'); return; }
    setBusy(true);
    try {
      await api.patch(`/requests/${requestId}/items`, {
        items: changed.map((i) => ({ itemId: i.id, quantity: Number(draft[i.id]) })),
        comment: v.comment,
        acknowledgeOverplaced: acknowledge || undefined,
        expectedVersion: rowVersion,
      });
      message.success('Объёмы изменены');
      onSaved();
      onClose();
    } catch (e) {
      const err = e as { message?: string; body?: { overplaced?: OverplacedItem[] } };
      const over = err.body?.overplaced;
      if (over?.length) {
        // Уменьшение ниже уже заказанного разрешено, но осознанно: показываем, что именно
        // окажется в перезаказе, и отдельно — что уже ушло в закупку или оформлено.
        const frozen = over.filter((o) => o.frozenPlaced > 0);
        modal.confirm({
          title: 'Заказано больше нового объёма',
          width: modalWidth(560),
          content: (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Text>Позиции окажутся в перезаказе:</Text>
              {over.map((o) => (
                <Text key={o.itemId} style={{ fontSize: 13 }}>
                  • {o.name}: заказано {round4(o.placed)}, новый объём {round4(Number(o.newQuantity))}
                </Text>
              ))}
              {frozen.length > 0 && (
                <Alert
                  type="warning" showIcon
                  message="Часть объёма уже в закупке или оформлена"
                  description={frozen.map((o) => `${o.name} — ${round4(o.frozenPlaced)}`).join('; ')}
                />
              )}
            </Space>
          ),
          okText: 'Всё равно сохранить',
          okButtonProps: { danger: true },
          cancelText: 'Отмена',
          onOk: () => submit(true),
        });
        return;
      }
      message.error(err.message ?? 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { title: '№', key: 'idx', width: 48, render: (_: unknown, __: RequestItem, i: number) => i + 1 },
    { title: 'Материал', dataIndex: 'name', key: 'name' },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
    ...(isSu10 ? [{
      title: 'Дата поставки', dataIndex: 'delivery_date', key: 'date', width: 130,
      render: (v: string | null) => fmtDate(v),
    }] : []),
    {
      title: 'Заявлено', dataIndex: 'quantity', key: 'was', width: 100, align: 'right' as const,
      render: (v: number | string) => round4(v),
    },
    {
      title: 'В заказах', dataIndex: 'placed', key: 'placed', width: 100, align: 'right' as const,
      render: (v: number | string | undefined) => {
        const n = Number(v ?? 0);
        return n > 0 ? <Tag>{round4(n)}</Tag> : <span style={{ color: '#bfbfbf' }}>—</span>;
      },
    },
    {
      title: 'Новый объём', key: 'new', width: 150, align: 'right' as const,
      render: (_: unknown, r: RequestItem) => {
        const value = draft[r.id] ?? Number(r.quantity);
        const placed = Number(r.placed ?? 0);
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <InputNumber
              min={0.0001} precision={4} style={{ width: '100%' }}
              value={value}
              onChange={(v) => setDraft((d) => ({ ...d, [r.id]: Number(v ?? 0) }))}
            />
            {value < placed && (
              <Text type="warning" style={{ fontSize: 11 }}>меньше размещённого ({round4(placed)})</Text>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <Modal
      open
      title="Изменение объёмов заявки"
      onCancel={onClose}
      onOk={() => submit(false)}
      confirmLoading={busy}
      okText="Сохранить"
      cancelText="Отмена"
      width={modalWidth(880)}
      destroyOnClose
    >
      <Table<RequestItem>
        rowKey="id" size="small" pagination={false}
        dataSource={items}
        columns={columns}
        scroll={{ y: 340 }}
        rowClassName={(r) => (Number(draft[r.id] ?? r.quantity) !== Number(r.quantity)
          ? ROW_HIGHLIGHTS.qtyChanged.className : '')}
      />

      {belowPlaced.length > 0 && (
        <Alert
          type="warning" showIcon style={{ marginTop: 12 }}
          message={`Ниже размещённого в заказах: ${belowPlaced.length} поз. — потребуется подтверждение`}
        />
      )}

      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item
          name="comment"
          label="Причина изменения"
          rules={[{ required: true, whitespace: true, message: 'Укажите комментарий' }]}
        >
          <Input.TextArea rows={3} maxLength={2000} placeholder="Что и почему изменилось" />
        </Form.Item>
      </Form>

      <Text type="secondary" style={{ fontSize: 12 }}>
        Объём можно задать и сверх сметного — проверка по смете не выполняется.
        Добавить или удалить материал можно только через доработку заявки.
      </Text>
    </Modal>
  );
}
