import { useEffect, useState } from 'react';
import { Descriptions, Space, Input, Button, Tag, Alert, Typography, App } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { MANUAL_VAT_RATE_LABELS, PAYMENT_TYPE_LABELS, type ManualVatRate, type PaymentType } from '@estimat/shared';
import { api } from '../../../services/api';
import { money } from '../requestConstants';
import { deliveryWindowOf, invoicesOf } from './orderHeader';
import type { SupplierOrderDetail } from '../types';

const { Text } = Typography;

const fmtDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };

/**
 * Шапка заказа: то, что нужно видеть всегда — поставщик, сумма, счета, окно поставок и заметка.
 * Заменяет собой шаги мастера: стадия читается из бейджа в заголовке окна, а не из подсвеченного шага.
 */
export function OrderHeaderBar({ order, readOnly, onCommentSaved }: {
  order: SupplierOrderDetail;
  /** Терминальные стадии: заметку менять уже незачем. */
  readOnly: boolean;
  onCommentSaved: () => void;
}) {
  const { message } = App.useApp();
  const invoices = invoicesOf(order);
  const window = deliveryWindowOf(order);

  // Черновик заметки. Сохраняется явной кнопкой, а не по blur: закрытие окна размонтировало бы
  // компонент раньше, чем пользователь увидел бы ошибку, и правка потерялась бы молча.
  const [draft, setDraft] = useState(order.comment ?? '');
  useEffect(() => { setDraft(order.comment ?? ''); }, [order.comment]);
  const dirty = draft.trim() !== (order.comment ?? '').trim();

  const saveComment = useMutation({
    mutationFn: () => api.patch(`/supplier-orders/${order.id}/comment`, { comment: draft.trim() || null }),
    onSuccess: () => { message.success('Комментарий сохранён'); onCommentSaved(); },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <>
      {order.needs_new_invoice && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message="Заказ изменился — приложите новый счёт"
          description="Состав или поставщик менялись после выставления действующего счёта."
        />
      )}

      <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Поставщик">
          {order.supplier_name ?? <Text type="secondary">не выбран</Text>}
          {order.supplier_inn ? `, ИНН ${order.supplier_inn}` : ''}
        </Descriptions.Item>
        <Descriptions.Item label="Сумма">
          {order.amount == null ? <Text type="secondary">—</Text> : money(order.amount)}
        </Descriptions.Item>

        <Descriptions.Item label="Счёт" span={2}>
          {invoices.length === 0 ? (
            <Text type="secondary">не приложен</Text>
          ) : (
            <Space size={[8, 4]} wrap>
              {invoices.map((i) => (
                <a
                  key={i.id}
                  style={i.superseded ? { color: 'var(--est-text-quaternary)', textDecoration: 'line-through' } : undefined}
                  onClick={() => api
                    .downloadGet(`/supplier-orders/${order.id}/invoices/${i.id}/file`, i.fileName ?? 'invoice')
                    .catch((e) => message.error((e as Error).message))}
                >
                  <PaperClipOutlined /> {i.label}
                </a>
              ))}
            </Space>
          )}
        </Descriptions.Item>

        <Descriptions.Item label="График поставок" span={2}>
          {window
            ? <>{fmtDate(window.from)} — {fmtDate(window.to)} <Tag style={{ marginLeft: 6 }}>{window.dates} дат</Tag></>
            : <Text type="secondary">не задан</Text>}
        </Descriptions.Item>

        {order.vat_rate && (
          <Descriptions.Item label="НДС">{MANUAL_VAT_RATE_LABELS[order.vat_rate as ManualVatRate]}</Descriptions.Item>
        )}
        {order.payment_type && (
          <Descriptions.Item label="Тип поставки">{PAYMENT_TYPE_LABELS[order.payment_type as PaymentType]}</Descriptions.Item>
        )}

        <Descriptions.Item label="Комментарий" span={2}>
          {readOnly ? (
            order.comment ? <span style={{ whiteSpace: 'pre-wrap' }}>{order.comment}</span> : <Text type="secondary">—</Text>
          ) : (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Input.TextArea
                value={draft} onChange={(e) => setDraft(e.target.value)}
                autoSize={{ minRows: 1, maxRows: 4 }} maxLength={2000}
                placeholder="Заметка по заказу"
              />
              {dirty && (
                <Space size={8}>
                  <Button size="small" type="primary" loading={saveComment.isPending} onClick={() => saveComment.mutate()}>
                    Сохранить
                  </Button>
                  <Button size="small" onClick={() => setDraft(order.comment ?? '')}>Отмена</Button>
                </Space>
              )}
            </Space>
          )}
        </Descriptions.Item>
      </Descriptions>
    </>
  );
}
