import { useMemo, useState } from 'react';
import {
  Table, Button, Space, Input, InputNumber, Select, Tag, Empty, Divider, Popconfirm, Alert, Typography, Upload, App,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, TrophyOutlined, PaperClipOutlined, UploadOutlined, CloseOutlined,
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
import { SupplierPicker, type SupplierSel } from './SupplierPicker';
import type { SupplierOrderDetail, OrderOffer, OrderAggItem } from '../types';

const { Text } = Typography;
const RESP_COLOR: Record<string, string> = { pending: 'default', received: 'green', no_response: 'warning' };
const roundMoney = (v: number) => Math.round(v * 100) / 100;

export interface WinnerDraft {
  winnerId?: string;
  /** Победитель обязан быть контрагентом из справочника — сами предложения набираются свободно. */
  winnerSupplier?: SupplierSel;
  vatRate: ManualVatRate;
  paymentType: PaymentType;
  prices: Map<string, { price: number | null; warranty: number | null }>;
}

/**
 * Блок «Поставщики»: кому отправлен запрос, что они прислали, кто выбран и по каким ценам.
 *
 * Поставщик добавляется свободной формой — названием и/или комментарием, без выбора из справочника:
 * КП приходят и от тех, кого в справочнике ещё нет, и ради одной строки заводить организацию
 * незачем. Справочник обязателен только у победителя, ниже в «Условиях выбранного поставщика».
 */
export function SuppliersBlock({
  order, canChooseWinner, draft, onDraftChange, onSubmitApproval, submitting, refetch,
}: {
  order: SupplierOrderDetail;
  /** Выбор победителя доступен только после фиксации состава; документы принимаются и до неё. */
  canChooseWinner: boolean;
  draft: WinnerDraft;
  onDraftChange: (patch: Partial<WinnerDraft>) => void;
  onSubmitApproval: () => void;
  submitting: boolean;
  refetch: () => void;
}) {
  const { message } = App.useApp();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File>();

  const offerMut = useMutation({
    mutationFn: (v: { method: 'post' | 'delete'; url: string; body?: unknown }) =>
      v.method === 'delete' ? api.delete(v.url) : api.post(v.url, v.body),
    onSuccess: () => refetch(),
    onError: (e: Error) => message.error(e.message),
  });

  /**
   * Добавление одной операцией: строка предложения, затем — если файл выбран — его загрузка.
   * Атомарности тут нет и не будет (файл идёт отдельным multipart-запросом), поэтому падение
   * загрузки НЕ откатывает строку: поставщик уже добавлен, и терять его из-за сбоя передачи
   * файла хуже, чем попросить приложить документ повторно в самой строке.
   */
  const addMut = useMutation({
    mutationFn: async (v: { supplierName?: string; note?: string; file?: File }) => {
      const created = await api.post<{ data: { id: string } }>(
        `/supplier-orders/${order.id}/offers`,
        { supplierName: v.supplierName, note: v.note },
      );
      if (!v.file) return { fileError: null as string | null };
      const fd = new FormData();
      fd.append('file', v.file);
      try {
        await api.upload(`/supplier-orders/${order.id}/offers/${created.data.id}/file?documentType=quote`, fd);
        return { fileError: null as string | null };
      } catch (e) {
        return { fileError: (e as Error).message };
      }
    },
    onSuccess: (r) => {
      if (r.fileError) message.warning(`Поставщик добавлен, но файл не загрузился: ${r.fileError}`);
      else message.success('Поставщик добавлен');
      setName(''); setNote(''); setFile(undefined);
    },
    onError: (e: Error) => message.error(e.message),
    onSettled: () => refetch(),
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
    const n = name.trim();
    const c = note.trim();
    if (!n && !c) return message.warning('Укажите название или комментарий');
    addMut.mutate({ supplierName: n || undefined, note: c || undefined, file });
  }

  /**
   * Выбор победителя. Справочный поставщик переустанавливается КАЖДЫЙ раз: если у новой строки
   * привязки нет, прежний контрагент должен исчезнуть, иначе на согласование ушло бы чужое КП
   * под именем поставщика из предыдущей строки.
   */
  function pickWinner(o: OrderOffer) {
    if (winnerId === o.id) return onDraftChange({ winnerId: undefined, winnerSupplier: undefined });
    onDraftChange({
      winnerId: o.id,
      winnerSupplier: o.supplier_id && o.supplier_name
        ? { id: o.supplier_id, name: o.supplier_name, inn: o.supplier_inn }
        : undefined,
    });
  }

  const offerCols: ColumnsType<OrderOffer> = [
    {
      title: 'Поставщик', dataIndex: 'supplier_name', key: 'sn', width: 260,
      render: (v, o) => (v
        ? <Space>{v}{o.supplier_inn ? <span style={{ color: 'var(--est-text-tertiary)' }}>ИНН {o.supplier_inn}</span> : null}</Space>
        : <span style={{ color: 'var(--est-text-quaternary)' }}>—</span>),
    },
    {
      title: 'Комментарий', dataIndex: 'note', key: 'note', ellipsis: true,
      render: (v: string | null) => v ?? <span style={{ color: 'var(--est-text-quaternary)' }}>—</span>,
    },
    {
      title: 'Ответ', dataIndex: 'response_status', key: 'rs', width: 150,
      render: (v) => <Tag color={RESP_COLOR[v]}>{OFFER_RESPONSE_STATUS_LABELS[v as keyof typeof OFFER_RESPONSE_STATUS_LABELS]}</Tag>,
    },
    {
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
    },
    {
      title: '', key: 'act', width: canChooseWinner ? 200 : 60, align: 'right',
      render: (_, o) => (
        <Space size={4}>
          {canChooseWinner && (
            <Button
              type={winnerId === o.id ? 'primary' : 'default'} size="small" icon={<TrophyOutlined />}
              disabled={o.response_status !== 'received' || !o.has_file}
              onClick={() => pickWinner(o)}
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
      {!canChooseWinner && (
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="Состав заказа ещё не зафиксирован"
          description="Собирать КП можно уже сейчас, но при изменении материалов или графика приложенные предложения могут устареть. Победитель выбирается после фиксации состава."
        />
      )}

      {/* Поставщик добавляется свободно: справочник нужен только победителю. */}
      <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
        <Input
          style={{ width: 260 }} value={name} onChange={(e) => setName(e.target.value)}
          maxLength={300} placeholder="Название (необязательно)"
        />
        <Input
          style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)}
          maxLength={1000} placeholder="Комментарий" onPressEnter={addSupplier}
        />
        <Upload
          showUploadList={false} maxCount={1}
          beforeUpload={(f) => { setFile(f); return false; }}
        >
          <Button icon={<UploadOutlined />}>{file ? 'Заменить файл' : 'Файл КП'}</Button>
        </Upload>
        <Button type="primary" icon={<PlusOutlined />} loading={addMut.isPending} onClick={addSupplier}>
          Добавить
        </Button>
      </Space.Compact>

      {file && (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <PaperClipOutlined /> {file.name}{' '}
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setFile(undefined)} />
          </Text>
        </div>
      )}

      <Table
        rowKey="id" size="small" pagination={false} dataSource={order.offers} columns={offerCols}
        locale={{ emptyText: <Empty description="Добавьте поставщиков, которым отправлен запрос КП" /> }}
        scroll={{ x: canChooseWinner ? 1000 : 860 }}
      />

      {rejected && (
        <Alert
          type="warning" showIcon style={{ marginTop: 12 }}
          message="Отклонено руководителем" description={order.approval_comment}
        />
      )}

      {canChooseWinner && winnerId && (
        <>
          <Divider orientation="left" plain>Условия выбранного поставщика</Divider>
          {/* Здесь свободная форма заканчивается: на согласование уходит контрагент из справочника —
              по нему дальше идут счета и оплаты. Название и ИНН заказа сервер берёт отсюда. */}
          <Space style={{ marginBottom: 12 }} size={8} align="center" wrap>
            <span>Поставщик из справочника:</span>
            <div style={{ width: 380 }}>
              <SupplierPicker value={draft.winnerSupplier} onChange={(s) => onDraftChange({ winnerSupplier: s })} />
            </div>
          </Space>
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

      {canChooseWinner && !winnerId && order.offers.length > 0 && (
        <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          Выберите победителя, чтобы указать цены и отправить заказ на согласование.
        </Text>
      )}
    </>
  );
}
