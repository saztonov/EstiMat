import { useState } from 'react';
import { Modal, Collapse, Button, Space, Tag, Alert, Dropdown, Input, Skeleton, App } from 'antd';
import {
  DeleteOutlined, MoreOutlined, FileExcelOutlined, EditOutlined, SwapOutlined, StopOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MANUAL_VAT_RATES, PAYMENT_TYPES, PROCUREMENT_ASSIGN_ROLES,
  SOURCING_STATUS_LABELS, TEMP_ALLOW_ANY_STATUS_ORDER_DELETE,
  type ManualVatRate, type PaymentType, type SourcingStatus,
} from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { SourcingStatusTag } from './supplierLotConstants';
import { CreateStep } from './supplierOrder/CreateStep';
import { OrderHeaderBar } from './supplierOrder/OrderHeaderBar';
import { CompositionBlock } from './supplierOrder/CompositionBlock';
import { SuppliersBlock, type WinnerDraft } from './supplierOrder/SuppliersBlock';
import { ApprovalStage } from './supplierOrder/ApprovalStage';
import { OrderItemsEditModal } from './supplierOrder/OrderItemsEditModal';
import { InvoicesBlock } from './supplierOrder/InvoicesBlock';
import { ProposalView } from './supplierOrder/ProposalView';
import { TenderView } from './supplierOrder/TenderView';
import { primaryActionOf, isCompositionEditable, orderNumberOf } from './supplierOrder/orderHeader';
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
  return <OrderStep orderId={id} onClose={onClose} onChanged={invalidateOutside} justCreated={!!create} />;
}

/**
 * Оболочка окна и загрузчик. Форма вынесена в OrderView и монтируется ТОЛЬКО когда заказ уже получен.
 *
 * Раньше состояние формы (победитель, НДС, тип поставки, цены) объявлялось здесь — до useQuery и
 * до раннего выхода по `!order`. Инициализировать его сохранёнными значениями было физически
 * нечем: при первом рендере данных ещё нет, а условные хуки после раннего выхода запрещены
 * правилами React.
 *
 * <Modal> живёт ЗДЕСЬ, а не в OrderView: пока заказ грузился, окно рисовалось отдельной модалкой
 * («Загрузка…»), а после ответа она размонтировалась и монтировалась вторая — с другой шириной и
 * своей анимацией. Пользователь видел, как окно подменяется. Теперь экземпляр один на все три
 * состояния (загрузка, ошибка, заказ), меняется только содержимое.
 *
 * Геометрия задаётся через styles.content (высота 90vh на самом .ant-modal-content), а не через
 * maxHeight тела: так окно не зависит от фактической высоты заголовка, и появление тегов стадии
 * после загрузки не двигает раскладку. paddingBottom: 0 снимает дефолтный отступ .ant-modal (24px),
 * из-за которого окно в 90vh давало бы лишнюю прокрутку страницы.
 *
 * key={orderId} обязателен: при переходе на другой заказ форма должна пересоздаться, иначе в ней
 * останется черновик предыдущего.
 */
function OrderStep({ orderId, onClose, onChanged, justCreated }: {
  orderId: string; onClose: () => void; onChanged: () => void; justCreated: boolean;
}) {
  const orderQ = useQuery({
    queryKey: ['supplier-order', orderId],
    queryFn: () => api.get<{ data: SupplierOrderDetail }>(`/supplier-orders/${orderId}`),
  });
  const order = orderQ.data?.data;
  const number = order ? orderNumberOf(order.order_no) : null;

  return (
    <Modal
      open onCancel={onClose} footer={null}
      width="90vw" style={{ top: '5vh', paddingBottom: 0 }}
      styles={{
        content: { height: '90vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
        header: { flexShrink: 0 },
        // Тело — только каркас: прокручивается внутренний контейнер, чтобы нижние кнопки не уезжали.
        body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
      }}
      title={
        <Space wrap>
          <span>Заказ поставщику{number ? ` ${number}` : ''}</span>
          {order && <SourcingStatusTag status={order.sourcing_status} />}
          {order?.project_name && <Tag>{order.project_name}</Tag>}
          {order?.procurement_method === 'tender' && <Tag color="blue">Тендер</Tag>}
        </Space>
      }
    >
      {order && number ? (
        <OrderView
          key={orderId} orderId={orderId} order={order} number={number} onClose={onClose}
          justCreated={justCreated} onChanged={onChanged} refetchOrder={() => { orderQ.refetch(); }}
        />
      ) : orderQ.isError ? (
        // Без этой ветки ошибка запроса оставляла окно в вечном «Загрузка…»: причина не видна и
        // повторить попытку нечем.
        <Alert
          type="error" showIcon
          message="Не удалось загрузить заказ"
          description={orderQ.error?.message}
          action={<Button size="small" onClick={() => orderQ.refetch()}>Повторить</Button>}
        />
      ) : (
        <Skeleton active paragraph={{ rows: 8 }} />
      )}
    </Modal>
  );
}

function OrderView({
  orderId, order, number, onClose, onChanged, justCreated, refetchOrder,
}: {
  orderId: string; order: SupplierOrderDetail; number: string; onClose: () => void; onChanged: () => void;
  justCreated: boolean; refetchOrder: () => void;
}) {
  // modal из useApp() (а не статический Modal.confirm) — иначе диалоги подтверждения
  // рендерятся вне ConfigProvider и в ночной теме остаются светлыми.
  const { message, modal } = App.useApp();
  const role = useAuthStore((s) => s.user?.role);
  const canApprove = PROCUREMENT_ASSIGN_ROLES.includes(role as never);

  // Черновик инициализируется из сохранённого ОДИН раз, при монтировании. Ленивый инициализатор,
  // а не useEffect на order: фоновое обновление после каждой мутации затирало бы несохранённые
  // правки пользователя прямо во время ввода цен.
  const [draft, setDraft] = useState<WinnerDraft>(() => {
    // Справочный поставщик восстанавливается из самого предложения: отклонённое возвращается на
    // доработку уже привязанным, и заставлять выбирать контрагента заново незачем.
    const proposed = order.offers.find((o) => o.id === order.proposed_offer_id);
    return {
      winnerId: order.proposed_offer_id ?? undefined,
      winnerSupplier: proposed?.supplier_id && proposed.supplier_name
        ? { id: proposed.supplier_id, name: proposed.supplier_name, inn: proposed.supplier_inn }
        : undefined,
      vatRate: (MANUAL_VAT_RATES as readonly string[]).includes(order.vat_rate ?? '')
        ? (order.vat_rate as ManualVatRate) : 'vat22',
      paymentType: (PAYMENT_TYPES as readonly string[]).includes(order.payment_type ?? '')
        ? (order.payment_type as PaymentType) : 'advance',
      prices: new Map(order.priceLines.map((p) => [p.agg_key, { price: Number(p.unit_price), warranty: p.warranty_months }])),
    };
  });
  const patchDraft = (patch: Partial<WinnerDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const status = order.sourcing_status;
  const isTender = order.procurement_method === 'tender';
  const editable = isCompositionEditable(order);
  // Документы поставщиков принимаются и до фиксации состава — после неё открывается выбор победителя.
  const canChooseWinner = status === 'sourcing';

  // Активный блок ВСЕГДА управляемый: после создания заказа и при смене стадии он должен
  // переключиться сам, а модалка при этом не размонтируется — defaultActiveKey сработал бы
  // только на первом рендере и оставил бы пользователя в свёрнутом виде.
  const [activeKeys, setActiveKeys] = useState<string[]>(
    () => (justCreated || editable ? ['composition'] : ['suppliers']),
  );
  const [itemsEditOpen, setItemsEditOpen] = useState(false);

  // Победитель мог исчезнуть, пока заказ лежал у руководителя: поставщика убрали или у него
  // отозвали файл. Ссылка на несуществующее предложение отправилась бы на согласование и была бы
  // отбита сервером — сбрасываем выбор здесь.
  const winnerAlive = draft.winnerId != null && order.offers.some((o) => o.id === draft.winnerId);
  const safeDraft: WinnerDraft = winnerAlive ? draft : { ...draft, winnerId: undefined, winnerSupplier: undefined };

  const refetch = () => { refetchOrder(); onChanged(); };

  const run = useMutation({
    mutationFn: (v: { method: 'post' | 'delete'; url: string; body?: unknown }) =>
      v.method === 'delete' ? api.delete(v.url) : api.post(v.url, v.body),
    onSuccess: () => refetch(),
    onError: (e: Error) => message.error(e.message),
  });

  const submitApproval = useMutation({
    mutationFn: (body: unknown) => api.post(`/supplier-orders/${orderId}/submit-approval`, body),
    onSuccess: () => { message.success('Заказ отправлен на согласование'); refetch(); },
    onError: (e: Error) => message.error(e.message),
  });

  async function freezeAndExport() {
    try {
      await api.post(`/supplier-orders/${orderId}/start`, { method: 'manual', expectedVersion: order.row_version });
      await api.download(`/supplier-orders/${orderId}/export`, undefined, `Запрос_КП_${number}.xlsx`);
      message.success('Состав зафиксирован, запрос КП скачан');
      setActiveKeys(['suppliers']); // дальше работают с поставщиками — открываем нужный блок
      refetch();
    } catch (e) { message.error((e as Error).message); }
  }
  async function reExport() {
    try { await api.download(`/supplier-orders/${orderId}/export`, undefined, `Запрос_КП_${number}.xlsx`); }
    catch (e) { message.error((e as Error).message); }
  }

  function onSubmitApproval() {
    if (!safeDraft.winnerId) return message.warning('Выберите победителя');
    if (!safeDraft.winnerSupplier) return message.warning('Выберите поставщика-победителя из справочника');
    const lines = order.aggItems.map((a) => ({
      aggKey: a.agg_key,
      unitPrice: safeDraft.prices.get(a.agg_key)?.price ?? null,
      warrantyMonths: safeDraft.prices.get(a.agg_key)?.warranty ?? null,
    }));
    if (lines.some((l) => l.unitPrice == null)) return message.warning('Укажите цену по всем материалам');
    submitApproval.mutate({
      winnerOfferId: safeDraft.winnerId,
      winnerSupplierId: safeDraft.winnerSupplier.id,
      vatRate: safeDraft.vatRate,
      paymentType: safeDraft.paymentType,
      lines: lines.map((l) => ({ aggKey: l.aggKey, unitPrice: String(l.unitPrice), warrantyMonths: l.warrantyMonths ?? undefined })),
      expectedVersion: order.row_version,
    });
  }

  // Состав правят до фиксации все, кто ведёт заказ, а после присуждения — только руководитель.
  const canEditItems = status === 'forming' || status === 'sourcing' || (status === 'awarded' && canApprove);
  const canCancel = ['forming', 'sourcing', 'approval'].includes(status) || (status === 'awarded' && canApprove);
  const canRevokeAward = status === 'awarded' && canApprove && !isTender;
  // TODO(temp): убрать вместе с TEMP_ALLOW_ANY_STATUS_ORDER_DELETE (@estimat/shared).
  const canTempDelete = TEMP_ALLOW_ANY_STATUS_ORDER_DELETE && role === 'admin'
    && !isTender && status !== 'forming';

  /** Отмена и смена поставщика требуют причины — спрашиваем её в одном месте. */
  function askReason(opts: {
    title: string; description: string; okText: string; required: boolean;
    onConfirm: (reason: string) => Promise<unknown>;
  }) {
    let reason = '';
    modal.confirm({
      title: opts.title,
      width: 520,
      okText: opts.okText,
      okButtonProps: { danger: true },
      cancelText: 'Отмена',
      content: (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <span>{opts.description}</span>
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 4 }} maxLength={2000}
            placeholder={opts.required ? 'Причина (обязательно)' : 'Причина (необязательно)'}
            onChange={(e) => { reason = e.target.value; }}
          />
        </Space>
      ),
      onOk: async () => {
        if (opts.required && !reason.trim()) {
          message.warning('Укажите причину');
          throw new Error('reason required'); // не закрывать окно
        }
        await opts.onConfirm(reason.trim());
      },
    });
  }

  const moreMenu = {
    items: [
      ...(canEditItems && order.items.length > 0
        ? [{ key: 'items', icon: <EditOutlined />, label: 'Изменить объёмы' }]
        : []),
      ...(canRevokeAward
        ? [{ key: 'revoke', icon: <SwapOutlined />, label: 'Сменить поставщика' }]
        : []),
      ...(status === 'forming' || canTempDelete
        ? [{ key: 'del', danger: true, icon: <DeleteOutlined />, label: status === 'forming' ? 'Удалить черновик' : 'Удалить заказ' }]
        : []),
      ...(canCancel
        ? [{ key: 'cancel', danger: true, icon: <StopOutlined />, label: 'Отменить заказ' }]
        : []),
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'items') setItemsEditOpen(true);
      if (key === 'del') {
        modal.confirm({
          title: status === 'forming' ? 'Удалить формируемый заказ?' : 'Удалить заказ?',
          content: status === 'forming' ? undefined
            : `Заказ в статусе «${SOURCING_STATUS_LABELS[status as SourcingStatus] ?? status}». Будут удалены предложения поставщиков с файлами, счета, цены, график и платежи — без возможности восстановления. Материалы вернутся в свод. Только для тестовых заказов.`,
          okText: 'Удалить', okButtonProps: { danger: true },
          onOk: () => api.delete(`/supplier-orders/${orderId}`).then(() => { message.success('Заказ удалён'); onChanged(); onClose(); }).catch((e) => message.error(e.message)),
        });
      }
      if (key === 'cancel') {
        askReason({
          title: 'Отменить заказ?',
          description: status === 'awarded'
            ? 'Поставщик уже согласован. Материалы вернутся в свод и станут доступны для нового заказа.'
            : 'Остаток материалов вернётся в свод.',
          okText: 'Отменить заказ',
          required: status === 'awarded',
          onConfirm: (reason) => api
            .post(`/supplier-orders/${orderId}/cancel`, { reason: reason || undefined, expectedVersion: order.row_version })
            .then(() => { message.success('Заказ отменён'); onChanged(); onClose(); })
            .catch((e) => { message.error(e.message); throw e; }),
        });
      }
      if (key === 'revoke') {
        askReason({
          title: 'Сменить поставщика?',
          description: 'Заказ вернётся к сбору предложений: состав и материалы сохранятся, поставщика и цены нужно будет выбрать заново.',
          okText: 'Сменить поставщика',
          required: true,
          onConfirm: (reason) => api
            .post(`/supplier-orders/${orderId}/revoke-award`, { reason, expectedVersion: order.row_version })
            .then(() => { message.success('Присуждение отозвано — выберите поставщика заново'); setActiveKeys(['suppliers']); refetch(); })
            .catch((e) => { message.error(e.message); throw e; }),
        });
      }
    },
  };

  const primary = primaryActionOf(order, canApprove);
  const terminal = status === 'cancelled' || status === 'no_award';

  // Блоки окна. Состав виден всегда; поставщики — во всех ручных стадиях, где они осмысленны.
  const blocks = [
    {
      key: 'composition',
      label: `Материалы и график${order.items.length ? ` · ${order.items.length} поз.` : ''}`,
      children: (
        <CompositionBlock
          order={order} editable={editable} refetch={refetch} onReExport={reExport}
          onRemoveItem={(itemId) => run.mutate({ method: 'delete', url: `/supplier-orders/${orderId}/items/${itemId}` })}
        />
      ),
    },
    ...(!isTender ? [{
      key: 'suppliers',
      label: `Поставщики${order.offers.length ? ` · ${order.offers.length}` : ''}`,
      children: status === 'approval' ? (
        <ApprovalStage order={order} number={number} onDone={refetch} />
      ) : status === 'awarded' ? (
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
      ) : terminal ? (
        <ProposalView order={order} />
      ) : (
        <SuppliersBlock
          order={order} canChooseWinner={canChooseWinner} draft={safeDraft} onDraftChange={patchDraft}
          onSubmitApproval={onSubmitApproval} submitting={submitApproval.isPending} refetch={refetch}
        />
      ),
    }] : []),
    // Счета появляются, когда поставщик уже определён: до этого прикладывать нечего.
    ...(!isTender && ['sourcing', 'approval', 'awarded'].includes(status) ? [{
      key: 'invoices',
      label: `Счета${order.invoices?.length ? ` · ${order.invoices.length}` : ''}`,
      children: <InvoicesBlock order={order} refetch={refetch} />,
    }] : []),
  ];

  // Разметка окна: прокручивается только верхний контейнер, нижняя панель закреплена. Боковые
  // отступы даёт сам .ant-modal-content — здесь их задавать нельзя, иначе удвоятся.
  return (
    <>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <OrderHeaderBar order={order} readOnly={terminal} onCommentSaved={refetch} />

        {terminal && (
          <Alert type="warning" showIcon style={{ marginBottom: 12 }}
            message="Заказ завершён без поставщика — материалы возвращены в свод" />
        )}

        {isTender && (
          <div style={{ marginBottom: 12 }}>
            <TenderView
              order={order}
              onRefresh={() => run.mutate({ method: 'post', url: `/supplier-orders/${orderId}/tender-refresh` })}
              onAward={(pid) => run.mutate({
                method: 'post', url: `/supplier-orders/${orderId}/award`,
                body: { source: 'tender', winnerParticipantId: pid, expectedVersion: order.row_version },
              })}
            />
          </div>
        )}

        <Collapse
          items={blocks}
          activeKey={activeKeys}
          onChange={(k) => setActiveKeys(Array.isArray(k) ? k : [k])}
        />
      </div>

      {/* Нижняя панель: одно главное действие стадии + редкие операции под «Ещё». */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
        gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--est-border)', flexWrap: 'wrap',
      }}>
        <div>
          {moreMenu.items.length > 0 && (
            <Dropdown menu={moreMenu as never}><Button icon={<MoreOutlined />}>Ещё</Button></Dropdown>
          )}
        </div>
        <Space wrap>
          <Button onClick={onClose}>Закрыть</Button>
          {primary.key === 'freeze' && (
            <Button type="primary" icon={<FileExcelOutlined />} onClick={freezeAndExport}>{primary.label}</Button>
          )}
        </Space>
      </div>

      {itemsEditOpen && (
        <OrderItemsEditModal order={order} onClose={() => setItemsEditOpen(false)} onSaved={refetch} />
      )}
    </>
  );
}
