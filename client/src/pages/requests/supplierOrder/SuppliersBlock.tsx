import { useMemo, useState } from 'react';
import {
  Table, Button, Space, InputNumber, Select, Tag, Empty, Divider, Popconfirm, Alert, Typography, App,
} from 'antd';
import { PlusOutlined, DeleteOutlined, TrophyOutlined, PaperClipOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useMutation } from '@tanstack/react-query';
import {
  MANUAL_VAT_RATES, MANUAL_VAT_RATE_LABELS, MANUAL_VAT_RATE_VALUE,
  PAYMENT_TYPES, PAYMENT_TYPE_LABELS,
  OFFER_RESPONSE_STATUS_LABELS, OFFER_DOC_TYPE_LABELS,
  type ManualVatRate, type PaymentType,
} from '@estimat/shared';
import { api } from '../../../services/api';
import { money, round4 } from '../requestConstants';
import { OfferUpload } from './OfferUpload';
import { SupplierPicker, type SupplierSel } from './SupplierPicker';
import type { SupplierOrderDetail, OrderOffer, OrderAggItem } from '../types';

const { Text } = Typography;
const RESP_COLOR: Record<string, string> = { pending: 'default', received: 'green', no_response: 'warning' };
const roundMoney = (v: number) => Math.round(v * 100) / 100;

export interface WinnerDraft {
  winnerId?: string;
  vatRate: ManualVatRate;
  paymentType: PaymentType;
  prices: Map<string, { price: number | null; warranty: number | null }>;
}

/**
 * Блок «Поставщики»: кому отправлен запрос, что они прислали, кто выбран и по каким ценам.
 *
 * Выбор поставщика встроен строкой, а не вынесен в модалку поверх окна — модалка поверх модалки
 * была частью той самой многооконности, ради устранения которой окно и собиралось в одно.
 */
export function SuppliersBlock({
  order, canCollectDocs, draft, onDraftChange, onSubmitApproval, submitting, refetch,
}: {
  order: SupplierOrderDetail;
  /** Приём КП/счетов и выбор победителя доступны только после фиксации состава. */
  canCollectDocs: boolean;
  draft: WinnerDraft;
  onDraftChange: (patch: Partial<WinnerDraft>) => void;
  onSubmitApproval: () => void;
  submitting: boolean;
  refetch: () => void;
}) {
  const { message } = App.useApp();
  const [pick, setPick] = useState<SupplierSel>();

  const offerMut = useMutation({
    mutationFn: (v: { method: 'post' | 'delete'; url: string; body?: unknown }) =>
      v.method === 'delete' ? api.delete(v.url) : api.post(v.url, v.body),
    onSuccess: () => refetch(),
    onError: (e: Error) => message.error(e.message),
  });

  const { winnerId, vatRate, paymentType, prices } = draft;
  const rate = Number(MANUAL_VAT_RATE_VALUE[vatRate]);
  const priceOf = (k: string) => prices.get(k) ?? { price: null, warranty: null };
  const setPrice = (k: string, patch: Partial<{ price: number | null; warranty: number | null }>) =>
    onDraftChange({ prices: new Map(prices).set(k, { ...priceOf(k), ...patch }) });

  const totals = useMemo(() => {
    let sum = 0;
    for (const a of order.aggItems) {
      const net = roundMoney(Number(a.quantity) * (prices.get(a.agg_key)?.price ?? 0));
      sum += net + roundMoney(net * rate);
    }
    return roundMoney(sum);
  }, [order.aggItems, prices, rate]);

  function addSupplier() {
    if (!pick) return message.warning('Выберите поставщика из справочника');
    offerMut.mutate(
      {
        method: 'post', url: `/supplier-orders/${order.id}/offers`,
        body: { supplierId: pick.id, supplierName: pick.name, supplierInn: pick.inn ?? undefined },
      },
      { onSuccess: () => { setPick(undefined); refetch(); } },
    );
  }

  const offerCols: ColumnsType<OrderOffer> = [
    {
      title: 'Поставщик', dataIndex: 'supplier_name', key: 'sn',
      render: (v, o) => <Space>{v}{o.supplier_inn ? <span style={{ color: '#8c8c8c' }}>ИНН {o.supplier_inn}</span> : null}</Space>,
    },
    {
      title: 'Ответ', dataIndex: 'response_status', key: 'rs', width: 170,
      render: (v) => <Tag color={RESP_COLOR[v]}>{OFFER_RESPONSE_STATUS_LABELS[v as keyof typeof OFFER_RESPONSE_STATUS_LABELS]}</Tag>,
    },
    ...(canCollectDocs ? [{
      title: 'Документ', key: 'doc', width: 200,
      render: (_: unknown, o: OrderOffer) => (
        <Space size={4}>
          {o.has_file ? (
            <a onClick={() => api.downloadGet(`/supplier-orders/${order.id}/offers/${o.id}/file`, o.file_name ?? 'file').catch((e) => message.error((e as Error).message))}>
              <PaperClipOutlined /> {o.document_type ? OFFER_DOC_TYPE_LABELS[o.document_type] : 'Файл'}
            </a>
          ) : <span style={{ color: '#bfbfbf' }}>нет</span>}
          <OfferUpload orderId={order.id} offerId={o.id} onDone={refetch} />
        </Space>
      ),
    } as const] : []),
    {
      title: '', key: 'act', width: canCollectDocs ? 200 : 60, align: 'right',
      render: (_, o) => (
        <Space size={4}>
          {canCollectDocs && (
            <Button
              type={winnerId === o.id ? 'primary' : 'default'} size="small" icon={<TrophyOutlined />}
              disabled={o.response_status !== 'received' || !o.has_file}
              onClick={() => onDraftChange({ winnerId: winnerId === o.id ? undefined : o.id })}
            >
              {winnerId === o.id ? 'Победитель' : 'Выбрать'}
            </Button>
          )}
          <Popconfirm title="Убрать поставщика?" onConfirm={() => offerMut.mutate({ method: 'delete', url: `/supplier-orders/${order.id}/offers/${o.id}` })}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const priceCols: ColumnsType<OrderAggItem> = [
    { title: 'Материал', dataIndex: 'material_name', key: 'm' },
    { title: 'Ед.', dataIndex: 'unit', key: 'u', width: 64 },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'q', width: 90, align: 'right', render: (v) => round4(v) },
    {
      title: 'Цена за ед.', key: 'price', width: 120, align: 'right',
      render: (_, a) => <InputNumber min={0} precision={2} value={priceOf(a.agg_key).price ?? undefined} style={{ width: 110 }}
        onChange={(v) => setPrice(a.agg_key, { price: v == null ? null : Number(v) })} />,
    },
    {
      title: 'Гарантия, мес.', key: 'w', width: 120, align: 'right',
      render: (_, a) => <InputNumber min={0} precision={0} value={priceOf(a.agg_key).warranty ?? undefined} style={{ width: 100 }}
        onChange={(v) => setPrice(a.agg_key, { warranty: v == null ? null : Number(v) })} />,
    },
    {
      title: 'Сумма НДС', key: 'vat', width: 120, align: 'right',
      render: (_, a) => { const net = roundMoney(Number(a.quantity) * (priceOf(a.agg_key).price ?? 0)); return money(roundMoney(net * rate)); },
    },
    {
      title: 'Сумма', key: 'sum', width: 130, align: 'right',
      render: (_, a) => { const net = roundMoney(Number(a.quantity) * (priceOf(a.agg_key).price ?? 0)); return <strong>{money(net + roundMoney(net * rate))}</strong>; },
    },
  ];

  // Отклонённое предложение возвращается сюда: показываем причину, чтобы было что исправлять.
  const rejected = !!order.approval_comment && !order.approved_at;

  return (
    <>
      {!canCollectDocs && (
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="Приложить КП и счета можно после фиксации состава"
          description="После фиксации материалы и график заказа изменить нельзя."
        />
      )}

      <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
        <div style={{ flex: 1 }}><SupplierPicker value={pick} onChange={setPick} /></div>
        <Button type="primary" icon={<PlusOutlined />} loading={offerMut.isPending} onClick={addSupplier}>
          Добавить
        </Button>
      </Space.Compact>

      <Table
        rowKey="id" size="small" pagination={false} dataSource={order.offers} columns={offerCols}
        locale={{ emptyText: <Empty description="Добавьте поставщиков, которым отправлен запрос КП" /> }}
        scroll={{ x: canCollectDocs ? 700 : 500 }}
      />

      {rejected && (
        <Alert
          type="warning" showIcon style={{ marginTop: 12 }}
          message="Отклонено руководителем" description={order.approval_comment}
        />
      )}

      {canCollectDocs && winnerId && (
        <>
          <Divider orientation="left" plain>Условия выбранного поставщика</Divider>
          <Space style={{ marginBottom: 12 }} size="large" wrap>
            <span>НДС: <Select value={vatRate} onChange={(v) => onDraftChange({ vatRate: v })} style={{ width: 130 }}
              options={MANUAL_VAT_RATES.map((r) => ({ value: r, label: MANUAL_VAT_RATE_LABELS[r] }))} /></span>
            <span>Тип поставки: <Select value={paymentType} onChange={(v) => onDraftChange({ paymentType: v })} style={{ width: 150 }}
              options={PAYMENT_TYPES.map((t) => ({ value: t, label: PAYMENT_TYPE_LABELS[t] }))} /></span>
          </Space>
          <Table rowKey="agg_key" size="small" pagination={false} dataSource={order.aggItems} columns={priceCols} scroll={{ x: 760 }}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={5}><strong>ИТОГО</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right"><strong>{money(totals)}</strong></Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          />
          <div style={{ textAlign: 'right', marginTop: 12 }}>
            <Button type="primary" loading={submitting} onClick={onSubmitApproval}>Отправить на согласование</Button>
          </div>
        </>
      )}

      {canCollectDocs && !winnerId && order.offers.length > 0 && (
        <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          Выберите победителя, чтобы указать цены и отправить заказ на согласование.
        </Text>
      )}
    </>
  );
}
