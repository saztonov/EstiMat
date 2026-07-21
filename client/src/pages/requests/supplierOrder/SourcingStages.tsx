import { useMemo, useState } from 'react';
import {
  Table, Button, Space, InputNumber, Select, Tag, Empty, Divider, Popconfirm, Dropdown, Alert, App,
} from 'antd';
import {
  ShoppingCartOutlined, DownloadOutlined, DeleteOutlined, TrophyOutlined, MoreOutlined, PaperClipOutlined,
} from '@ant-design/icons';
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
import { AddSupplierModal } from './SupplierPicker';
import type { SupplierOrderDetail, OrderOffer, OrderAggItem } from '../types';

const RESP_COLOR: Record<string, string> = { pending: 'default', received: 'green', no_response: 'warning' };
const roundMoney = (v: number) => Math.round(v * 100) / 100;

/** Этапы «Поставщики» + «Оформление» (sourcing): приём документов, выбор победителя, цены. */
export function SourcingStages({
  order, winnerLocal, setWinnerLocal, vatRate, setVatRate, paymentType, setPaymentType,
  prices, setPrices, onReExport, moreMenu, refetch, onClose,
}: {
  order: SupplierOrderDetail;
  winnerLocal?: string; setWinnerLocal: (v?: string) => void;
  vatRate: ManualVatRate; setVatRate: (v: ManualVatRate) => void;
  paymentType: PaymentType; setPaymentType: (v: PaymentType) => void;
  prices: Map<string, { price: number | null; warranty: number | null }>;
  setPrices: (m: Map<string, { price: number | null; warranty: number | null }>) => void;
  onReExport: () => void; moreMenu: { items: unknown[]; onClick: (e: { key: string }) => void };
  refetch: () => void; onClose: () => void;
}) {
  const { message } = App.useApp();
  const [addOpen, setAddOpen] = useState(false);
  const winnerId = winnerLocal;

  const offerMut = useMutation({
    mutationFn: (v: { method: 'post' | 'patch' | 'delete'; url: string; body?: unknown }) =>
      v.method === 'delete' ? api.delete(v.url) : v.method === 'patch' ? api.patch(v.url, v.body) : api.post(v.url, v.body),
    onSuccess: () => refetch(),
    onError: (e: Error) => message.error(e.message),
  });

  // Прямое присуждение закрыто: предложение уходит руководителю на согласование.
  const finalize = useMutation({
    mutationFn: (body: unknown) => api.post(`/supplier-orders/${order.id}/submit-approval`, body),
    onSuccess: () => { message.success('Заказ оформлен'); refetch(); onClose(); },
    onError: (e: Error) => message.error(e.message),
  });

  const rate = Number(MANUAL_VAT_RATE_VALUE[vatRate]);
  const priceOf = (k: string) => prices.get(k) ?? { price: null, warranty: null };
  const setPrice = (k: string, patch: Partial<{ price: number | null; warranty: number | null }>) =>
    setPrices(new Map(prices).set(k, { ...priceOf(k), ...patch }));

  const totals = useMemo(() => {
    let sum = 0;
    for (const a of order.aggItems) {
      const p = priceOf(a.agg_key).price ?? 0;
      const net = roundMoney(Number(a.quantity) * p);
      const vat = roundMoney(net * rate);
      sum += net + vat;
    }
    return roundMoney(sum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.aggItems, prices, rate]);

  const offerCols: ColumnsType<OrderOffer> = [
    {
      title: 'Поставщик', dataIndex: 'supplier_name', key: 'sn',
      render: (v, o) => <Space>{v}{o.supplier_inn ? <span style={{ color: '#8c8c8c' }}>ИНН {o.supplier_inn}</span> : null}</Space>,
    },
    { title: 'Ответ', dataIndex: 'response_status', key: 'rs', width: 170, render: (v) => <Tag color={RESP_COLOR[v]}>{OFFER_RESPONSE_STATUS_LABELS[v as keyof typeof OFFER_RESPONSE_STATUS_LABELS]}</Tag> },
    {
      title: 'Документ', key: 'doc', width: 200,
      render: (_, o) => (
        <Space size={4}>
          {o.has_file ? (
            <a onClick={() => api.downloadGet(`/supplier-orders/${order.id}/offers/${o.id}/file`, o.file_name ?? 'file').catch((e) => message.error((e as Error).message))}>
              <PaperClipOutlined /> {o.document_type ? OFFER_DOC_TYPE_LABELS[o.document_type] : 'Файл'}
            </a>
          ) : <span style={{ color: '#bfbfbf' }}>нет</span>}
          <OfferUpload orderId={order.id} offerId={o.id} onDone={refetch} />
        </Space>
      ),
    },
    {
      title: '', key: 'act', width: 200, align: 'right',
      render: (_, o) => (
        <Space size={4}>
          <Button
            type={winnerId === o.id ? 'primary' : 'default'} size="small" icon={<TrophyOutlined />}
            disabled={o.response_status !== 'received' || !o.has_file}
            onClick={() => setWinnerLocal(winnerId === o.id ? undefined : o.id)}
          >
            {winnerId === o.id ? 'Победитель' : 'Выбрать'}
          </Button>
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

  function submitFinalize() {
    if (!winnerId) return message.warning('Выберите победителя');
    const lines = order.aggItems.map((a) => ({ aggKey: a.agg_key, unitPrice: priceOf(a.agg_key).price, warrantyMonths: priceOf(a.agg_key).warranty }));
    if (lines.some((l) => l.unitPrice == null)) return message.warning('Укажите цену по всем материалам');
    if (totals <= 0) return message.warning('Итоговая сумма должна быть больше нуля');
    finalize.mutate({
      winnerOfferId: winnerId,
      vatRate, paymentType,
      lines: lines.map((l) => ({ aggKey: l.aggKey, unitPrice: String(l.unitPrice), warrantyMonths: l.warrantyMonths ?? undefined })),
      expectedVersion: order.row_version,
    });
  }

  return (
    <>
      <Space style={{ marginBottom: 8 }}>
        <Button icon={<DownloadOutlined />} onClick={onReExport}>Скачать запрос КП</Button>
        <Button icon={<ShoppingCartOutlined />} onClick={() => setAddOpen(true)}>Добавить поставщика</Button>
        <Dropdown menu={moreMenu as never}><Button icon={<MoreOutlined />}>Ещё</Button></Dropdown>
      </Space>
      <Table rowKey="id" size="small" pagination={false} dataSource={order.offers} columns={offerCols}
        locale={{ emptyText: <Empty description="Добавьте поставщиков, которым отправлен запрос КП" /> }} scroll={{ x: 700 }} />

      {/* Причина отклонения — ВНЕ условия на победителя: раньше блок был вложен в него, и если
          выбор победителя не восстановился, отклонённый заказ открывался вообще без объяснения,
          почему он вернулся к снабжению. */}
      {rejected && (
        <Alert
          type="warning" showIcon style={{ marginTop: 12 }}
          message="Отклонено руководителем"
          description={order.approval_comment}
        />
      )}

      {winnerId && (
        <>
          <Divider orientation="left" plain>Оформление победителя</Divider>
          <Space style={{ marginBottom: 12 }} size="large">
            <span>НДС: <Select value={vatRate} onChange={setVatRate} style={{ width: 130 }}
              options={MANUAL_VAT_RATES.map((r) => ({ value: r, label: MANUAL_VAT_RATE_LABELS[r] }))} /></span>
            <span>Тип поставки: <Select value={paymentType} onChange={setPaymentType} style={{ width: 150 }}
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
          <div style={{ textAlign: 'right', marginTop: 16 }}>
            <Button type="primary" loading={finalize.isPending} onClick={submitFinalize}>Отправить на согласование</Button>
          </div>
        </>
      )}

      <AddSupplierModal
        open={addOpen} onClose={() => setAddOpen(false)}
        onSubmit={(body) => offerMut.mutate({ method: 'post', url: `/supplier-orders/${order.id}/offers`, body }, { onSuccess: () => { setAddOpen(false); refetch(); } })}
      />
    </>
  );
}
