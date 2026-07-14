import { useState } from 'react';
import { App, Button, Space, Table, Tag, Descriptions, Modal, Form, Input, InputNumber, DatePicker, Select, Divider, Popconfirm, Alert } from 'antd';
import { DownloadOutlined, ReloadOutlined, LinkOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TENDER_VAT_RATES, TENDER_VAT_RATE_LABELS } from '@estimat/shared';
import { api } from '../../services/api';
import { money, round4 } from './requestConstants';
import { SourcingStatusTag, ProcurementMethodTag, TenderStatusTag } from './supplierLotConstants';
import type { SupplierLotDetail as LotDetail, SupplierLotItem, SupplierLotOffer } from './types';

function useLot(lotId: string) {
  return useQuery({
    queryKey: ['supplier-lot', lotId],
    queryFn: () => api.get<{ data: LotDetail }>(`/supplier-orders/${lotId}`),
  });
}

export function SupplierLotDetail({ lotId }: { lotId: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useLot(lotId);
  const [tenderOpen, setTenderOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);

  const lot = data?.data;
  const invalidate = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['supplier-lots'] });
  };

  const run = useMutation({
    mutationFn: (vars: { url: string; body?: unknown }) => api.post(vars.url, vars.body),
    onSuccess: () => { message.success('Готово'); invalidate(); },
    onError: (e: Error) => message.error(e.message),
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/supplier-orders/${lotId}`),
    onSuccess: () => { message.success('Лот удалён'); queryClient.invalidateQueries({ queryKey: ['supplier-lots'] }); },
    onError: (e: Error) => message.error(e.message),
  });

  const delItem = useMutation({
    mutationFn: (itemId: string) => api.delete(`/supplier-orders/${lotId}/items/${itemId}`),
    onSuccess: () => { message.success('Позиция убрана'); invalidate(); },
    onError: (e: Error) => message.error(e.message),
  });

  async function downloadKp() {
    try {
      await api.download(`/supplier-orders/${lotId}/export`, undefined, 'Запрос_КП.xlsx');
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  if (isLoading || !lot) return <div style={{ padding: 12 }}>Загрузка…</div>;
  const ev = lot.row_version;
  const isForming = lot.sourcing_status === 'forming';
  const isSourcing = lot.sourcing_status === 'sourcing';
  const isManual = lot.procurement_method === 'manual';
  const isTender = lot.procurement_method === 'tender';
  const tenderFinished = lot.tender_status === 'finished';
  const outcome = lot.tender_results?.outcome;
  const winnerId = lot.tender_results?.winner?.participant_id;
  const isNoAward = lot.sourcing_status === 'no_award' || outcome === 'no_award';

  const itemCols: ColumnsType<SupplierLotItem> = [
    { title: 'Материал', dataIndex: 'material_name', key: 'name' },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'qty', width: 100, align: 'right', render: (v) => round4(v) },
    { title: 'Подрядчик', dataIndex: 'contractor_name', key: 'contractor', width: 160, render: (v) => v ?? '—' },
    { title: 'Заявка', dataIndex: 'request_no', key: 'req', width: 80, render: (v) => (v ? `№ ${v}` : '—') },
    ...(isForming ? [{
      title: '', key: 'del', width: 60,
      render: (_: unknown, it: SupplierLotItem) => (
        <Popconfirm title="Убрать позицию из лота?" onConfirm={() => delItem.mutate(it.id)}>
          <Button type="link" size="small" danger>Убрать</Button>
        </Popconfirm>
      ),
    } as const] : []),
  ];

  const offerCols: ColumnsType<SupplierLotOffer> = [
    { title: 'Поставщик', dataIndex: 'supplier_name', key: 'sn' },
    { title: 'ИНН', dataIndex: 'supplier_inn', key: 'inn', width: 140, render: (v) => v ?? '—' },
    { title: 'Сумма', dataIndex: 'amount', key: 'amount', width: 140, align: 'right', render: (v) => money(v) },
    { title: 'Условия', dataIndex: 'terms', key: 'terms', render: (v) => v ?? '—' },
    ...(isSourcing && isManual ? [{
      title: '', key: 'act', width: 160,
      render: (_: unknown, o: SupplierLotOffer) => (
        <Popconfirm title="Зафиксировать этого поставщика?" onConfirm={() => run.mutate({ url: `/supplier-orders/${lotId}/award`, body: { source: 'manual', quoteId: o.id, expectedVersion: ev } })}>
          <Button type="link" size="small">Выбрать поставщика</Button>
        </Popconfirm>
      ),
    } as const] : []),
  ];

  return (
    <div style={{ padding: '4px 8px 12px' }}>
      <Descriptions size="small" column={3} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Стадия"><SourcingStatusTag status={lot.sourcing_status} /></Descriptions.Item>
        <Descriptions.Item label="Канал"><ProcurementMethodTag method={lot.procurement_method} /></Descriptions.Item>
        <Descriptions.Item label="Тендер">
          <Space size={4}>
            <TenderStatusTag status={lot.tender_status} />
            {lot.tender_url && <a href={lot.tender_url} target="_blank" rel="noopener noreferrer"><LinkOutlined /></a>}
          </Space>
        </Descriptions.Item>
        {lot.sourcing_status === 'awarded' && (
          <>
            <Descriptions.Item label="Поставщик">{lot.supplier_name ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Сумма">{money(lot.amount)}</Descriptions.Item>
          </>
        )}
      </Descriptions>

      {lot.tender_sync_status === 'pending' && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Тендер поставлен в очередь на выгрузку в портал" />
      )}
      {lot.tender_sync_status === 'failed' && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message={`Ошибка выгрузки тендера: ${lot.tender_last_error ?? ''}`} />
      )}
      {isNoAward && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Тендер завершён без победителя — остаток материалов возвращён в свод" />
      )}

      {/* Действия по стадии */}
      <Space wrap style={{ marginBottom: 12 }}>
        <Button icon={<DownloadOutlined />} onClick={downloadKp}>Скачать запрос КП</Button>
        {isForming && (
          <>
            <Popconfirm title="Начать сбор КП по почте? Состав лота будет заморожен." onConfirm={() => run.mutate({ url: `/supplier-orders/${lotId}/start`, body: { method: 'manual', expectedVersion: ev } })}>
              <Button type="primary">Начать закупку (по почте)</Button>
            </Popconfirm>
            <Button onClick={() => setTenderOpen(true)}>Создать тендер</Button>
            <Popconfirm title="Удалить формируемый лот?" onConfirm={() => del.mutate()}>
              <Button danger>Удалить лот</Button>
            </Popconfirm>
          </>
        )}
        {isSourcing && isManual && (
          <Button type="primary" onClick={() => setOfferOpen(true)}>Добавить КП</Button>
        )}
        {isSourcing && isTender && (
          <>
            <Button icon={<ReloadOutlined />} onClick={() => run.mutate({ url: `/supplier-orders/${lotId}/tender-refresh` })}>Обновить результаты</Button>
            {tenderFinished && winnerId && outcome !== 'no_award' && (
              <Popconfirm title="Зафиксировать победителя тендера?" onConfirm={() => run.mutate({ url: `/supplier-orders/${lotId}/award`, body: { source: 'tender', winnerParticipantId: winnerId, expectedVersion: ev } })}>
                <Button type="primary">Зафиксировать победителя</Button>
              </Popconfirm>
            )}
          </>
        )}
        {(isSourcing || lot.sourcing_status === 'cancel_pending') && (
          <Popconfirm title="Отменить лот? Остаток материалов вернётся в свод." onConfirm={() => run.mutate({ url: `/supplier-orders/${lotId}/cancel` })}>
            <Button danger>Отменить лот</Button>
          </Popconfirm>
        )}
      </Space>

      <Table<SupplierLotItem> rowKey="id" size="small" pagination={false} dataSource={lot.items} columns={itemCols} scroll={{ x: 700 }} />

      <Divider style={{ margin: '12px 0' }} orientation="left" plain>Заявки-источники</Divider>
      <Space wrap>
        {lot.sources.map((s) => (
          <Tag key={s.request_id}>№ {s.request_no ?? '—'} · {s.contractor_name ?? '—'}</Tag>
        ))}
      </Space>

      {isManual && lot.offers.length > 0 && (
        <>
          <Divider style={{ margin: '12px 0' }} orientation="left" plain>Коммерческие предложения</Divider>
          <Table<SupplierLotOffer> rowKey="id" size="small" pagination={false} dataSource={lot.offers} columns={offerCols} scroll={{ x: 600 }} />
        </>
      )}

      {isTender && lot.tender_results && (
        <>
          <Divider style={{ margin: '12px 0' }} orientation="left" plain>Результаты тендера</Divider>
          <Table
            rowKey="participant_id"
            size="small"
            pagination={false}
            dataSource={(lot.tender_results.bids ?? []).map((b) => ({
              ...b,
              name: lot.tender_results?.participants?.find((p) => p.id === b.participant_id)?.name ?? b.participant_id,
              isWinner: b.participant_id === winnerId,
            }))}
            columns={[
              { title: 'Участник', dataIndex: 'name', key: 'name', render: (v, r: { isWinner: boolean }) => <Space>{v}{r.isWinner && <Tag color="green">Победитель</Tag>}</Space> },
              { title: 'Ставка', dataIndex: 'amount', key: 'amount', width: 160, align: 'right', render: (v) => money(v) },
            ]}
          />
        </>
      )}

      {/* Модалка «Создать тендер» */}
      <Modal
        open={tenderOpen}
        title="Создать тендер"
        onCancel={() => setTenderOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form
          layout="vertical"
          initialValues={{ vatRate: 'vat20', place: lot.project_name ?? undefined }}
          onFinish={(v) => {
            run.mutate({
              url: `/supplier-orders/${lotId}/tender`,
              body: {
                method: 'tender',
                expectedVersion: ev,
                tender: {
                  deadlineAt: v.deadlineAt.toISOString(),
                  vatRate: v.vatRate ?? 'vat20',
                  place: v.place || null,
                  delivery: v.delivery || null,
                  payment: v.payment || null,
                  deadline: v.deadline || null,
                },
              },
            }, { onSuccess: () => { setTenderOpen(false); message.success('Тендер поставлен в очередь на выгрузку'); invalidate(); } });
          }}
        >
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Тендер будет опубликован на портале сразу (приём предложений начнётся немедленно)." />
          <Form.Item
            name="deadlineAt"
            label="Дедлайн приёма ставок"
            rules={[{ required: true, message: 'Укажите дедлайн приёма ставок' }]}
          >
            <DatePicker showTime style={{ width: '100%' }} disabledDate={(d) => !!d && d.endOf('day').valueOf() < Date.now()} />
          </Form.Item>
          <Form.Item name="vatRate" label="Ставка НДС">
            <Select options={TENDER_VAT_RATES.map((r) => ({ value: r, label: TENDER_VAT_RATE_LABELS[r] }))} />
          </Form.Item>
          <Form.Item name="place" label="Место поставки"><Input /></Form.Item>
          <Form.Item name="delivery" label="Условия поставки"><Input /></Form.Item>
          <Form.Item name="payment" label="Условия оплаты"><Input /></Form.Item>
          <Form.Item name="deadline" label="Срок поставки"><Input /></Form.Item>
          <Button type="primary" htmlType="submit" loading={run.isPending}>Выгрузить в портал</Button>
        </Form>
      </Modal>

      {/* Модалка «Добавить КП» */}
      <Modal
        open={offerOpen}
        title="Коммерческое предложение"
        onCancel={() => setOfferOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form
          layout="vertical"
          onFinish={(v) => {
            run.mutate({
              url: `/supplier-orders/${lotId}/offers`,
              body: {
                supplierName: v.supplierName,
                supplierInn: v.supplierInn || null,
                amount: v.amount,
                terms: v.terms || null,
                note: v.note || null,
              },
            }, { onSuccess: () => { setOfferOpen(false); message.success('КП добавлено'); invalidate(); } });
          }}
        >
          <Form.Item name="supplierName" label="Поставщик" rules={[{ required: true, message: 'Укажите поставщика' }]}><Input /></Form.Item>
          <Form.Item name="supplierInn" label="ИНН"><Input /></Form.Item>
          <Form.Item name="amount" label="Сумма, ₽" rules={[{ required: true, message: 'Укажите сумму' }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="terms" label="Условия"><Input /></Form.Item>
          <Form.Item name="note" label="Примечание"><Input.TextArea rows={2} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={run.isPending}>Добавить</Button>
        </Form>
      </Modal>
    </div>
  );
}
