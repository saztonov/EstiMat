import { useState } from 'react';
import { Modal, Steps, Space, Tag, Alert, App } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MANUAL_VAT_RATES, PAYMENT_TYPES, type ManualVatRate, type PaymentType,
} from '@estimat/shared';
import { api } from '../../services/api';
import { CreateStep } from './supplierOrder/CreateStep';
import { FormingStage } from './supplierOrder/FormingStage';
import { SourcingStages } from './supplierOrder/SourcingStages';
import { ApprovalStage } from './supplierOrder/ApprovalStage';
import { ProposalView } from './supplierOrder/ProposalView';
import { TenderView } from './supplierOrder/TenderView';
import type { Su10MaterialRow, SupplierOrderDetail } from './types';

interface Props {
  // Создание из выбранных материалов свода.
  create?: { projectId: string; rows: Su10MaterialRow[] };
  // Просмотр/оформление существующего заказа.
  orderId?: string;
  onClose: () => void;
  onChanged?: () => void;
}

export function SupplierOrderModal({ create, orderId, onClose, onChanged }: Props) {
  const qc = useQueryClient();
  const [createdId, setCreatedId] = useState<string | undefined>(orderId);
  const id = createdId;

  const invalidateOutside = () => {
    qc.invalidateQueries({ queryKey: ['su10-materials'] });
    qc.invalidateQueries({ queryKey: ['supplier-lots'] });
    qc.invalidateQueries({ queryKey: ['purchases-registry'] });
    onChanged?.();
  };

  if (!id) {
    return (
      <CreateStep
        projectId={create!.projectId}
        rows={create!.rows}
        onCancel={onClose}
        onCreated={(newId) => { setCreatedId(newId); invalidateOutside(); }}
      />
    );
  }
  return <OrderStep orderId={id} onClose={onClose} onChanged={invalidateOutside} fromMaterials={!!create} />;
}

/**
 * Загрузчик. Форма вынесена в OrderView и монтируется ТОЛЬКО когда заказ уже получен.
 *
 * Раньше состояние формы (победитель, НДС, тип поставки, цены) объявлялось здесь — до useQuery и
 * до раннего выхода по `!order`. Инициализировать его сохранёнными значениями было физически
 * нечем: при первом рендере данных ещё нет, а условные хуки после раннего выхода запрещены
 * правилами React. Из-за этого заказ, отклонённый руководителем, открывался с пустой формой:
 * причина отклонения не показывалась (её блок вложен в условие «выбран победитель»), цены
 * приходилось вбивать заново — хотя сервер всё сохранил.
 *
 * key={orderId} обязателен: при переходе на другой заказ форма должна пересоздаться, иначе в ней
 * останется черновик предыдущего.
 */
function OrderStep({ orderId, onClose, onChanged, fromMaterials }: {
  orderId: string; onClose: () => void; onChanged: () => void; fromMaterials: boolean;
}) {
  const orderQ = useQuery({
    queryKey: ['supplier-order', orderId],
    queryFn: () => api.get<{ data: SupplierOrderDetail }>(`/supplier-orders/${orderId}`),
  });
  const order = orderQ.data?.data;

  if (orderQ.isLoading || !order) {
    return <Modal open title="Заказ поставщику" footer={null} onCancel={onClose}><div style={{ padding: 24 }}>Загрузка…</div></Modal>;
  }
  return (
    <OrderView
      key={orderId} orderId={orderId} order={order} onClose={onClose} fromMaterials={fromMaterials}
      onChanged={onChanged} refetchOrder={() => { orderQ.refetch(); }}
    />
  );
}

function OrderView({
  orderId, order, onClose, onChanged, fromMaterials, refetchOrder,
}: {
  orderId: string; order: SupplierOrderDetail; onClose: () => void; onChanged: () => void;
  fromMaterials: boolean; refetchOrder: () => void;
}) {
  const { message } = App.useApp();

  // Черновик инициализируется из сохранённого ОДИН раз, при монтировании. Ленивый инициализатор,
  // а не useEffect на order: фоновое обновление после каждой мутации затирало бы несохранённые
  // правки пользователя прямо во время ввода цен.
  const [winnerLocal, setWinnerLocal] = useState<string | undefined>(() => order.proposed_offer_id ?? undefined);
  const [vatRate, setVatRate] = useState<ManualVatRate>(
    () => (MANUAL_VAT_RATES as readonly string[]).includes(order.vat_rate ?? '') ? (order.vat_rate as ManualVatRate) : 'vat22',
  );
  const [paymentType, setPaymentType] = useState<PaymentType>(
    () => (PAYMENT_TYPES as readonly string[]).includes(order.payment_type ?? '') ? (order.payment_type as PaymentType) : 'advance',
  );
  const [prices, setPrices] = useState<Map<string, { price: number | null; warranty: number | null }>>(
    () => new Map(order.priceLines.map((p) => [p.agg_key, { price: Number(p.unit_price), warranty: p.warranty_months }])),
  );

  // Победитель мог исчезнуть, пока заказ лежал у руководителя: поставщика убрали или у него
  // отозвали файл. Ссылка на несуществующее предложение отправилась бы на согласование и была бы
  // отбита сервером — сбрасываем выбор здесь.
  const winnerAlive = winnerLocal != null && order.offers.some((o) => o.id === winnerLocal);
  const winnerLocalSafe = winnerAlive ? winnerLocal : undefined;

  const refetch = () => { refetchOrder(); onChanged(); };

  const run = useMutation({
    mutationFn: (v: { method: 'post' | 'delete'; url: string; body?: unknown }) =>
      v.method === 'delete' ? api.delete(v.url) : api.post(v.url, v.body),
    onSuccess: () => refetch(),
    onError: (e: Error) => message.error(e.message),
  });

  const number = `З-${String(order.order_no ?? 0).padStart(3, '0')}`;
  const isTender = order.procurement_method === 'tender';
  const status = order.sourcing_status;
  // Шаги: Состав → Поставщики → Оформление. Согласование и присуждение — последний шаг.
  const stepIndex = status === 'forming' ? 0 : (status === 'awarded' || status === 'approval') ? 2 : 1;

  async function freezeAndExport() {
    try {
      await api.post(`/supplier-orders/${orderId}/start`, { method: 'manual', expectedVersion: order!.row_version });
      await api.download(`/supplier-orders/${orderId}/export`, undefined, `Запрос_КП_${number}.xlsx`);
      message.success('Состав зафиксирован, запрос КП скачан');
      refetch();
    } catch (e) { message.error((e as Error).message); }
  }
  async function reExport() {
    try { await api.download(`/supplier-orders/${orderId}/export`, undefined, `Запрос_КП_${number}.xlsx`); }
    catch (e) { message.error((e as Error).message); }
  }

  const moreMenu = {
    items: [
      ...(status === 'forming'
        ? [{ key: 'del', danger: true, icon: <DeleteOutlined />, label: 'Удалить черновик' }]
        : []),
      ...(status === 'sourcing'
        ? [{ key: 'cancel', danger: true, icon: <DeleteOutlined />, label: 'Отменить заказ' }]
        : []),
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'del') {
        Modal.confirm({
          title: 'Удалить формируемый заказ?', okText: 'Удалить', okButtonProps: { danger: true },
          onOk: () => api.delete(`/supplier-orders/${orderId}`).then(() => { message.success('Заказ удалён'); onChanged(); onClose(); }).catch((e) => message.error(e.message)),
        });
      }
      if (key === 'cancel') {
        Modal.confirm({
          title: 'Отменить заказ? Остаток материалов вернётся в свод.', okText: 'Отменить', okButtonProps: { danger: true },
          onOk: () => api.post(`/supplier-orders/${orderId}/cancel`).then(() => { message.success('Заказ отменён'); onChanged(); onClose(); }).catch((e) => message.error(e.message)),
        });
      }
    },
  };

  return (
    <Modal
      open width={960} onCancel={onClose} footer={null}
      title={
        <Space>
          <span>Заказ поставщику {number}</span>
          {order.project_name && <Tag>{order.project_name}</Tag>}
          {isTender && <Tag color="blue">Тендер</Tag>}
        </Space>
      }
    >
      {!isTender && <Steps size="small" current={stepIndex} style={{ marginBottom: 16 }}
        items={[{ title: 'Состав' }, { title: 'Поставщики' }, { title: 'Оформление' }]} />}

      {/* ===== Тендер: компактный статус (read-only) ===== */}
      {isTender && (
        <TenderView order={order} onRefresh={() => run.mutate({ method: 'post', url: `/supplier-orders/${orderId}/tender-refresh` })}
          onAward={(pid) => run.mutate({ method: 'post', url: `/supplier-orders/${orderId}/award`, body: { source: 'tender', winnerParticipantId: pid, expectedVersion: order.row_version } })} />
      )}

      {/* ===== Этап «Состав» (forming): состав + запрос КП + поставщики (без приёма КП/победителя) ===== */}
      {!isTender && status === 'forming' && (
        <FormingStage
          order={order} fromMaterials={fromMaterials}
          onFreezeExport={freezeAndExport} onReExport={reExport} moreMenu={moreMenu}
          onRemoveItem={(itemId) => run.mutate({ method: 'delete', url: `/supplier-orders/${orderId}/items/${itemId}` })}
          refetch={refetch}
        />
      )}

      {/* ===== Этапы «Поставщики» + «Оформление» (sourcing) ===== */}
      {!isTender && status === 'sourcing' && (
        <SourcingStages
          order={order}
          winnerLocal={winnerLocalSafe} setWinnerLocal={setWinnerLocal}
          vatRate={vatRate} setVatRate={setVatRate}
          paymentType={paymentType} setPaymentType={setPaymentType}
          prices={prices} setPrices={setPrices}
          onReExport={reExport} moreMenu={moreMenu} refetch={refetch} onClose={onClose}
        />
      )}

      {/* ===== Оформлен (awarded) — read-only ===== */}
      {!isTender && status === 'approval' && (
        <ApprovalStage order={order} number={number} onDone={refetch} />
      )}

      {!isTender && status === 'awarded' && (
        <>
          <ProposalView order={order} />
          {(order.approved_by_name || order.approval_comment) && (
            <Alert
              type="success" showIcon style={{ marginTop: 12 }}
              message={order.approved_by_name
                ? `Согласовал: ${order.approved_by_name}${order.approved_at ? ` · ${new Date(order.approved_at).toLocaleDateString('ru-RU')}` : ''}`
                : 'Поставщик согласован'}
              description={order.approval_comment ?? undefined}
            />
          )}
        </>
      )}

      {(status === 'cancelled' || status === 'no_award') && (
        <Alert type="warning" showIcon message="Заказ завершён без поставщика — материалы возвращены в свод" />
      )}
    </Modal>
  );
}
