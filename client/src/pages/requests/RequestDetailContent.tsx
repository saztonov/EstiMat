import { useState } from 'react';
import {
  Card, Descriptions, Table, Space, Button, Tag, Empty, Timeline, Alert, Modal, Collapse, Tabs,
  Form, Input, InputNumber, DatePicker, Typography, Spin, App, Popconfirm, Tooltip,
} from 'antd';
import {
  FileExcelOutlined, DownloadOutlined, EyeOutlined,
  DeleteOutlined, DollarOutlined, ShopOutlined, RollbackOutlined,
  FileDoneOutlined, SendOutlined, CloseCircleOutlined, CheckCircleOutlined, SyncOutlined,
  LinkOutlined, EditOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  REQUEST_DOC_TYPES, RP_APPLICATION_DOC_TYPES, REQUEST_DOC_TYPE_LABELS, type RequestDocType,
} from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { modalWidth } from '../../lib/modalWidth';
import { safeExternalHref } from '../../lib/safeUrl';
import { NumberInput } from '../../components/NumberInput';
import { formatSize } from '../../lib/files';
import { RequestStatusTag, RequestTypeTag, money, round4 } from './requestConstants';
import { RpFormModal } from './RpFormModal';
import { RpSendModal } from './RpSendModal';
import { OrderEditModal } from './OrderEditModal';
import { RequestItemsEditModal } from './RequestItemsEditModal';
import { HistoryChanges } from './HistoryChangesView';
import { TableLegend } from '../../components/table/TableLegend';
import { ROW_HIGHLIGHTS } from '../../lib/rowHighlights';
import { RequestLotsSection } from './RequestLotsSection';
import { SupplierOrderModal } from './SupplierOrderModal';
import { DeliveryGantt, type GanttMaterial } from '../contractors/DeliveryGantt';
import { CommentsChat } from './CommentsChat';
import { FileUploadList, type UploadItem } from '../../components/files/FileUploadList';
import { FilePreviewModal } from '../../components/files/FilePreview';
import type { RequestDetail, RequestItem, RequestFile, RequestPayment, Su10MaterialRow } from './types';

const { Text, Title } = Typography;

const ACTION_LABELS: Record<string, string> = {
  created: 'Заявка создана',
  status_changed: 'Статус изменён',
  supplier_selected: 'Выбран поставщик',
  payment_added: 'Добавлена оплата',
  revision_requested: 'Отправлена на доработку',
  revision_completed: 'Доработка завершена',
  rp_application_submitted: 'Оформление РП',
  rp_sent: 'РП отправлено',
  rp_annulled: 'РП аннулирована',
  cancelled: 'Заявка отменена',
  order_updated: 'Изменены реквизиты',
  file_added: 'Добавлен файл',
  file_removed: 'Удалён файл',
  file_rejected: 'Документ вычеркнут',
  file_restored: 'Документ восстановлен',
  items_quantity_updated: 'Изменены объёмы',
};

/**
 * Карточка заявки (стиль billhub ViewRequestModal): реквизиты + действия, затем секции-блоки
 * (Состав / Документы / Оплаты / История / Обсуждение). Предпросмотр файлов — всем ролям.
 */
export function RequestDetailContent(
  { id, onBack, backLabel = 'Закрыть' }: { id: string; onBack?: () => void; backLabel?: string },
) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isSupply = role === 'engineer' || role === 'admin' || role === 'manager';
  const isContractor = role === 'contractor';

  const [supplierOpen, setSupplierOpen] = useState(false);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [rpFormOpen, setRpFormOpen] = useState(false);
  const [rpSendOpen, setRpSendOpen] = useState(false);
  const [orderEditOpen, setOrderEditOpen] = useState(false);
  const [itemsEditOpen, setItemsEditOpen] = useState(false);
  const [docFiles, setDocFiles] = useState<UploadItem[]>([]);
  const [preview, setPreview] = useState<{ fileId: string; fileName: string; mimeType: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [supForm] = Form.useForm();
  const [payForm] = Form.useForm();
  const [revForm] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['requests', 'detail', id],
    queryFn: () => api.get<{ data: RequestDetail }>(`/requests/${id}`),
    enabled: !!id,
  });
  const r = data?.data;

  // Материалы su10-заявки в формате свода — для кнопки «Создать заказ поставщику».
  const lotsQ = useQuery({
    queryKey: ['request-lots', id],
    queryFn: () => api.get<{ data: { projectId: string | null; materials: Omit<Su10MaterialRow, 'assigned_responsibles'>[] } }>(
      `/supplier-orders/by-request/${id}`,
    ),
    enabled: !!id && r?.request_type === 'su10' && isSupply,
  });
  const orderProjectId = lotsQ.data?.data?.projectId ?? null;
  const orderableMaterials: Su10MaterialRow[] = (lotsQ.data?.data?.materials ?? [])
    .filter((m) => Number(m.remaining ?? 0) > 0)
    .map((m) => ({ ...m, assigned_responsibles: [] }));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['requests', 'detail', id] });
    qc.invalidateQueries({ queryKey: ['requests', 'list'] });
    qc.invalidateQueries({ queryKey: ['requests', 'rp-registry'] });
    qc.invalidateQueries({ queryKey: ['requests', 'by-estimate'] });
    qc.invalidateQueries({ queryKey: ['material-requests'] });
    // Свод «Материалы» строится по позициям заявок — правка объёмов/отмена заявки меняет его.
    qc.invalidateQueries({ queryKey: ['su10-materials'] });
  };

  const mut = (fn: () => Promise<unknown>, okMsg: string) => async () => {
    setBusy(true);
    try { await fn(); message.success(okMsg); invalidate(); return true; }
    catch (e) { message.error((e as Error).message); return false; }
    finally { setBusy(false); }
  };

  async function submitSupplier() {
    const v = await supForm.validateFields();
    const ok = await mut(
      () => api.post(`/requests/${id}/supplier`, {
        supplierName: v.supplierName, supplierInn: v.supplierInn || null,
        resultAmount: v.resultAmount, expectedVersion: r?.row_version,
      }),
      'Поставщик сохранён',
    )();
    if (ok) { setSupplierOpen(false); supForm.resetFields(); }
  }

  async function submitPayment() {
    const v = await payForm.validateFields();
    const ok = await mut(
      () => api.post(`/requests/${id}/payments`, {
        amount: v.amount, paidAt: v.paidAt ? v.paidAt.format('YYYY-MM-DD') : null,
        docNumber: v.docNumber || null, comment: v.comment || null,
        clientPaymentId: crypto.randomUUID(),
      }),
      'Оплата добавлена',
    )();
    if (ok) { setPaymentOpen(false); payForm.resetFields(); }
  }

  async function submitRevision() {
    const v = await revForm.validateFields();
    const ok = await mut(
      () => api.post(`/requests/${id}/revision`, { comment: v.comment, expectedVersion: r?.row_version }),
      'Отправлено на доработку',
    )();
    if (ok) { setRevisionOpen(false); revForm.resetFields(); }
  }

  const completeRevision = mut(() => api.post(`/requests/${id}/revision-complete`, {}), 'Отправлено на проверку');
  const cancelRequest = mut(() => api.post(`/requests/${id}/cancel`, { expectedVersion: r?.row_version }), 'Заявка отменена');
  const resync = mut(() => api.post(`/requests/${id}/rp-resync`, {}), 'Повторная синхронизация запущена');

  async function uploadDocs() {
    if (docFiles.some((f) => !f.docType)) { message.warning('Укажите тип для каждого документа'); return; }
    setBusy(true);
    try {
      for (const f of docFiles) {
        const fd = new FormData();
        fd.append('file', f.file);
        await api.upload(`/requests/${id}/files?docType=${f.docType}`, fd);
      }
      message.success('Документы загружены');
      setDocFiles([]);
      invalidate();
    } catch (e) { message.error((e as Error).message); }
    finally { setBusy(false); }
  }

  const deleteFile = (fileId: string) => mut(() => api.delete(`/requests/${id}/files/${fileId}`), 'Файл удалён');
  const rejectFile = (fileId: string, isRejected: boolean) => mut(
    () => api.patch(`/requests/${id}/files/${fileId}/rejection`, { isRejected }),
    isRejected ? 'Документ вычеркнут' : 'Документ восстановлен',
  );

  async function exportExcel() {
    try { await api.download(`/requests/${id}/export`, {}, `Заявка_${r?.number ?? id}.xlsx`); }
    catch (e) { message.error((e as Error).message); }
  }

  function downloadFile(f: RequestFile) {
    api.downloadGet(`/requests/${id}/file/${f.id}`, f.file_name).catch((e) => message.error((e as Error).message));
  }

  if (isLoading) return <div style={{ padding: 48 }}><Spin /></div>;
  if (!r) return <div style={{ padding: 48 }}><Empty description="Заявка не найдена" /></div>;

  const isOwnSupplier = r.request_type === 'own_supplier';
  const isDirectRoute = r.request_type === 'own_supply';
  const isSu10 = r.request_type === 'su10';

  const canApplyRp = isContractor && isOwnSupplier && ['in_work', 'revision'].includes(r.status);
  // Отмена: own_supplier — до отправки РП; su10 — до ухода материалов в закупку (сервер освободит
  // формируемые лоты, а при активной закупке вернёт 409).
  const canCancel =
    // «Оплата по РП»: подрядчик — только до первой смены статуса (пока «В работе»); снабжение — до отправки РП.
    (isOwnSupplier && (
      (isContractor && r.status === 'in_work') ||
      (isSupply && ['in_work', 'rp_forming', 'revision'].includes(r.status))
    )) ||
    // su10: до ухода материалов в закупку (сервер освободит формируемые лоты, при активной закупке — 409).
    (isSu10 && (isContractor || isSupply) && ['in_work', 'revision'].includes(r.status));
  const canSendRp = isSupply && isOwnSupplier && r.status === 'rp_forming';
  const canReviseRp = isSupply && isOwnSupplier && ['in_work', 'rp_forming'].includes(r.status);
  const canPayRp = isSupply && isOwnSupplier && ['rp_sent', 'rp_paid'].includes(r.status);
  const canResync = isSupply && isOwnSupplier && r.rp_letter?.sync_status === 'failed';

  const canEditFiles = isContractor && ['in_work', 'rp_forming', 'revision'].includes(r.status);
  // Удаление документов: подрядчик — до отправки РП; инженер/снабжение — на любом этапе (сервер разрешает internal).
  const canDeleteFiles = canEditFiles || isSupply;
  // Вычёркивание документов («Оплата по РП», снабжение и подрядчик, до отправки РП).
  const canRejectFiles = isOwnSupplier && (isSupply || isContractor)
    && ['in_work', 'rp_forming', 'revision'].includes(r.status);
  // Правка реквизитов оформленной заявки (до отправки в PayHub).
  const canEditOrder = isOwnSupplier && !!r.order && r.status === 'rp_forming' && (isSupply || isContractor);
  const canRevisionComplete = isContractor && !isOwnSupplier && r.status === 'revision';
  const canRevisionStd = isSupply && !isOwnSupplier && r.status === 'in_work';
  // Ручной ввод поставщика/суммы — только «собственная поставка» (own_supply). Для su10 —
  // формирование заказа поставщику через свод материалов (кнопка «Создать заказ поставщику»).
  const canSetSupplier = isDirectRoute && (isSupply || isContractor) && !isOwnSupplier
    && r.status !== 'delivered' && r.status !== 'revision' && r.status !== 'cancelled';
  const canCreateOrder = isSu10 && isSupply
    && r.status !== 'delivered' && r.status !== 'revision' && r.status !== 'cancelled'
    && orderableMaterials.length > 0;
  const canPayStd = isSupply && !isOwnSupplier && !!r.order && r.status !== 'delivered';
  const canUploadDocs = canEditFiles || isSupply;
  const uploadDocOptions = (isSupply ? REQUEST_DOC_TYPES : RP_APPLICATION_DOC_TYPES)
    .map((d) => ({ value: d, label: REQUEST_DOC_TYPE_LABELS[d as RequestDocType] }));

  // Правка объёмов: снабжение может уточнить количества, не трогая состав заявки.
  const canEditItems = isSupply && (isOwnSupplier
    ? r.status === 'in_work'
    : ['in_work', 'supplier_selected'].includes(r.status));
  const hasQtyEdits = r.items.some((it) => !!it.quantity_changed_at);

  /** Подсказка «было столько · кто · когда» у изменённого количества. */
  const qtyCell = (v: number | string, it: RequestItem) => {
    if (!it.quantity_changed_at) return round4(v);
    const was = round4(it.quantity_original ?? v);
    const who = it.quantity_changed_by_name ?? 'снабжение';
    const when = new Date(it.quantity_changed_at).toLocaleDateString('ru-RU');
    return (
      <Tooltip title={`Было ${was} · ${who} · ${when}`}>
        <Space size={4}>
          {round4(v)}
          <Tag color="gold" style={{ margin: 0 }}>изм.</Tag>
        </Space>
      </Tooltip>
    );
  };

  const itemCols: ColumnsType<RequestItem> = [
    { title: '№', key: 'idx', width: 50, render: (_, __, i) => i + 1 },
    { title: 'Наименование', dataIndex: 'name', key: 'name' },
    { title: 'Ед.изм.', dataIndex: 'unit', key: 'unit', width: 90 },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'quantity', width: 140, align: 'right', render: qtyCell },
    { title: 'Вид работ', dataIndex: 'cost_type_name', key: 'cost_type_name', render: (v: string | null) => v || '—' },
  ];

  // График поставки (СУ-10): свёртка позиций по материалу — общее кол-во + строки дат.
  const fmtRuDate = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}`; };
  const hasSchedule = r.request_type === 'su10' && r.items.some((it) => !!it.delivery_date);
  const scheduleGroups = (() => {
    const map = new Map<string, { name: string; unit: string; cost_type_name: string | null; totalQty: number; entries: { date: string | null; qty: number; item: RequestItem }[] }>();
    for (const it of r.items) {
      const key = it.agg_key || `${it.name}|${it.unit}`;
      let g = map.get(key);
      if (!g) { g = { name: it.name, unit: it.unit, cost_type_name: it.cost_type_name, totalQty: 0, entries: [] }; map.set(key, g); }
      g.totalQty += Number(it.quantity);
      // Тащим саму позицию: в графике ячейки объединены rowSpan, и подсветку строки видно плохо —
      // отметку об изменении объёма показываем прямо в количестве конкретной даты.
      g.entries.push({ date: it.delivery_date, qty: Number(it.quantity), item: it });
    }
    return [...map.values()];
  })();
  const scheduleRows = scheduleGroups.flatMap((g, gi) =>
    g.entries.map((e, ei) => ({ rowId: `${gi}#${ei}`, gi, idx: ei, count: g.entries.length, group: g, entry: e })),
  );
  const spanCell = (row: { idx: number; count: number }) => ({ rowSpan: row.idx === 0 ? row.count : 0 });
  const scheduleItemCols: ColumnsType<(typeof scheduleRows)[number]> = [
    { title: 'Наименование', key: 'name', onCell: spanCell, render: (_, row) => row.group.name },
    { title: 'Ед.изм.', key: 'unit', width: 90, onCell: spanCell, render: (_, row) => row.group.unit },
    { title: 'Общее кол-во', key: 'total', width: 120, align: 'right', onCell: spanCell, render: (_, row) => round4(row.group.totalQty) },
    { title: 'Дата поставки', key: 'date', width: 140, render: (_, row) => (row.entry.date ? fmtRuDate(row.entry.date) : '—') },
    { title: 'Кол-во', key: 'qty', width: 140, align: 'right', render: (_, row) => qtyCell(row.entry.qty, row.entry.item) },
    { title: 'Вид работ', key: 'cost_type_name', onCell: spanCell, render: (_, row) => row.group.cost_type_name || '—' },
  ];
  const ganttMaterials: GanttMaterial[] = scheduleGroups.map((g, i) => ({
    key: String(i), name: g.name, unit: g.unit, totalQty: g.totalQty,
    schedule: g.entries.filter((e) => e.date).map((e) => ({ date: e.date as string, qty: e.qty })),
  }));

  const payCols: ColumnsType<RequestPayment> = [
    { title: 'Сумма', dataIndex: 'amount', key: 'amount', align: 'right', render: (v, p) => (p.reversed ? <Text delete>{money(v)}</Text> : money(v)) },
    { title: 'Дата', dataIndex: 'paid_at', key: 'paid_at', render: (v: string | null) => v ? new Date(v).toLocaleDateString('ru-RU') : '—' },
    { title: '№ документа', dataIndex: 'doc_number', key: 'doc_number', render: (v: string | null) => v || '—' },
    { title: 'Комментарий', dataIndex: 'comment', key: 'comment', render: (v: string | null) => v || '—' },
  ];

  const fileSide = (roleOfUploader: string | null) =>
    roleOfUploader && ['admin', 'engineer', 'manager'].includes(roleOfUploader)
      ? 'СУ-10'
      : (r.contractor_name || 'Подрядчик');

  const fileCols: ColumnsType<RequestFile> = [
    { title: 'Тип', dataIndex: 'doc_type', key: 'doc_type', width: 180,
      render: (v: string) => <Tag>{REQUEST_DOC_TYPE_LABELS[v as RequestDocType] ?? v}</Tag> },
    { title: 'Имя', dataIndex: 'file_name', key: 'file_name', ellipsis: true,
      render: (v: string, f) => (f.is_rejected ? (
        <Tooltip title={`Вычеркнул: ${f.rejected_by_name || '—'}${f.rejected_at ? ' · ' + new Date(f.rejected_at).toLocaleString('ru-RU') : ''}`}>
          <span style={{ textDecoration: 'line-through', color: 'var(--est-text-tertiary)' }}>{v}</span>
        </Tooltip>
      ) : v) },
    { title: 'Размер', dataIndex: 'file_size', key: 'file_size', width: 90, render: (v: number | null) => formatSize(v) },
    { title: 'Загрузил', key: 'author', width: 190, render: (_, f) => (
      <div style={{ lineHeight: 1.2 }}>
        <div>{f.created_by_name || '—'}</div>
        <Text type="secondary" style={{ fontSize: 12 }}>{fileSide(f.created_by_role)}</Text>
      </div>
    ) },
    { title: '', key: 'act', width: 140, align: 'right', render: (_, f) => (
      <Space size={4}>
        <Button size="small" type="text" icon={<EyeOutlined />}
          onClick={() => setPreview({ fileId: f.id, fileName: f.file_name, mimeType: f.mime_type })} />
        <Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => downloadFile(f)} />
        {canRejectFiles && (
          <Tooltip title={f.is_rejected ? 'Вернуть' : 'Вычеркнуть'}>
            <Button size="small" type="text" loading={busy}
              icon={f.is_rejected ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              style={{ color: f.is_rejected ? 'var(--est-success)' : 'var(--est-error)' }}
              onClick={rejectFile(f.id, !f.is_rejected)} />
          </Tooltip>
        )}
        {canDeleteFiles && (
          <Popconfirm title="Удалить документ?" okText="Удалить" cancelText="Отмена" okButtonProps={{ danger: true }} onConfirm={deleteFile(f.id)}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        )}
      </Space>
    ) },
  ];

  const rpReg = r.rp_letter?.payhub_reg_number || r.order?.rp_number;

  const sections = [
    {
      key: 'materials',
      label: `Материалы (${hasSchedule ? scheduleGroups.length : r.items.length})`,
      children: hasSchedule ? (
        <Tabs
          defaultActiveKey="materials"
          items={[
            {
              key: 'materials',
              label: 'Материалы',
              children: (
                <>
                  <Table rowKey="rowId" size="small" pagination={false} bordered
                    columns={scheduleItemCols} dataSource={scheduleRows} scroll={{ x: 700 }} />
                  {hasQtyEdits && <TableLegend items={[ROW_HIGHLIGHTS.qtyChanged]} style={{ marginTop: 8 }} />}
                </>
              ),
            },
            {
              key: 'schedule',
              label: 'График поставки',
              children: <DeliveryGantt materials={ganttMaterials} />,
            },
          ]}
        />
      ) : (
        <>
          <Table<RequestItem> rowKey="id" size="small" pagination={false}
            columns={itemCols} dataSource={r.items} scroll={{ x: 600 }}
            rowClassName={(it) => (it.quantity_changed_at ? ROW_HIGHLIGHTS.qtyChanged.className : '')} />
          {hasQtyEdits && <TableLegend items={[ROW_HIGHLIGHTS.qtyChanged]} style={{ marginTop: 8 }} />}
        </>
      ),
    },
    ...(r.request_type === 'su10' && isSupply ? [{
      key: 'lots',
      label: 'Заказы',
      children: <RequestLotsSection requestId={id} />,
    }] : []),
    {
      key: 'files',
      label: `Документы (${r.files.length})`,
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {r.files.length === 0
            ? <Text type="secondary">Файлов нет</Text>
            : <Table<RequestFile> rowKey="id" size="small" pagination={false} columns={fileCols} dataSource={r.files} scroll={{ x: 560 }}
                rowClassName={(f) => (f.is_rejected ? 'file-rejected-row' : '')} />}
          {canUploadDocs && (
            <div>
              <FileUploadList value={docFiles} onChange={setDocFiles} docTypeOptions={uploadDocOptions} />
              {docFiles.length > 0 && (
                <Button type="primary" style={{ marginTop: 8 }} loading={busy} onClick={uploadDocs}>
                  Загрузить ({docFiles.length})
                </Button>
              )}
            </div>
          )}
        </Space>
      ),
    },
    ...(r.payments.length > 0 ? [{
      key: 'payments',
      label: 'Оплаты',
      children: <Table<RequestPayment> rowKey="id" size="small" pagination={false} columns={payCols} dataSource={r.payments} />,
    }] : []),
    ...(r.history.length > 0 ? [{
      key: 'history',
      label: 'История',
      children: (
        <Timeline items={r.history.map((h) => ({
          children: (
            <Space direction="vertical" size={0}>
              <Text>{ACTION_LABELS[h.action] ?? h.action}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {h.actor_name || 'Система'} · {new Date(h.created_at).toLocaleString('ru-RU')}
              </Text>
              {/* Комментарии и подробности сервер писал всегда, но раньше они не отображались. */}
              <HistoryChanges action={h.action} changes={h.changes} />
            </Space>
          ),
        }))} />
      ),
    }] : []),
    {
      key: 'chat',
      label: 'Обсуждение',
      children: <CommentsChat requestId={id} />,
    },
  ];

  return (
    <Card
      title={
        <Space>
          <span>Заявка {r.number}</span>
          <RequestTypeTag type={r.request_type} />
          <RequestStatusTag status={r.status} comment={r.revision_reason} />
        </Space>
      }
      extra={<Button icon={<FileExcelOutlined />} onClick={exportExcel}>Экспорт в Excel</Button>}
      variant="borderless"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ header: { paddingLeft: 16, paddingRight: 44 }, body: { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 } }}
    >
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Title level={5} style={{ margin: 0 }}>
          {r.contractor_name || '—'}{r.contractor_inn ? `, ИНН ${r.contractor_inn}` : ''}
        </Title>

        {r.status === 'revision' && r.revision_reason && (
          <Alert type="warning" showIcon message="Возвращено на доработку" description={r.revision_reason} />
        )}
        {r.rp_letter?.sync_status === 'failed' && (
          <Alert type="error" showIcon message="Ошибка синхронизации письма РП с PayHub"
            description={r.rp_letter.last_error || 'Повторите синхронизацию.'} />
        )}

        <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
          <Descriptions.Item label="Объект">{r.project_name || '—'}</Descriptions.Item>
          <Descriptions.Item label="Смета">{r.estimate_label || '—'}</Descriptions.Item>
          <Descriptions.Item label="Поставщик">
            {r.order?.supplier_name || r.supplier_name || '—'}
            {r.order?.supplier_inn ? `, ИНН ${r.order.supplier_inn}` : ''}
          </Descriptions.Item>
          <Descriptions.Item label="Сумма счёта">{money(r.order?.amount ?? r.order_amount)}</Descriptions.Item>
          {isOwnSupplier && r.order?.delivery_days ? (
            <Descriptions.Item label="Срок поставки">
              {r.order.delivery_days} {r.order.delivery_days_type === 'calendar' ? 'кал.' : 'раб.'} дн.
            </Descriptions.Item>
          ) : null}
          {isOwnSupplier && r.order?.shipping_conditions ? (
            <Descriptions.Item label="Условия отгрузки">{r.order.shipping_conditions}</Descriptions.Item>
          ) : null}
          {rpReg ? <Descriptions.Item label="№ РП">{rpReg}</Descriptions.Item> : null}
          {r.order?.rp_date ? (
            <Descriptions.Item label="Дата РП">{new Date(r.order.rp_date).toLocaleDateString('ru-RU')}</Descriptions.Item>
          ) : null}
          {r.rp_letter?.payhub_url ? (
            <Descriptions.Item label="Письмо PayHub">
              <a href={safeExternalHref(r.rp_letter.payhub_url)} target="_blank" rel="noopener noreferrer">Открыть <LinkOutlined /></a>
            </Descriptions.Item>
          ) : null}
          <Descriptions.Item label="Создана">{new Date(r.created_at).toLocaleString('ru-RU')}</Descriptions.Item>
          {/* Кто завёл заявку. Владелец — всегда подрядчик в заголовке; автором может быть и
              сотрудник, оформивший заявку от его имени. */}
          {r.created_by_name && (
            <Descriptions.Item label="Создал">{r.created_by_name}</Descriptions.Item>
          )}
        </Descriptions>

        <Collapse defaultActiveKey={[]} items={sections} />
      </Space>
      </div>

      {/* Нижняя панель управления: слева закрытие, справа действия по роли/статусу */}
      <div style={{
        flexShrink: 0, borderTop: '1px solid var(--est-border)', padding: '10px 16px',
        display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      }}>
        <div>{onBack && <Button onClick={onBack}>{backLabel}</Button>}</div>
        <Space wrap>
          {canApplyRp && (
            <Button type="primary" icon={<FileDoneOutlined />} onClick={() => setRpFormOpen(true)}>
              {r.status === 'revision' ? 'Исправить и отправить' : 'Оформить РП'}
            </Button>
          )}
          {canSendRp && <Button type="primary" icon={<SendOutlined />} onClick={() => setRpSendOpen(true)}>Отправить РП</Button>}
          {canReviseRp && <Button icon={<RollbackOutlined />} onClick={() => setRevisionOpen(true)}>На доработку</Button>}
          {canPayRp && <Button icon={<DollarOutlined />} onClick={() => setPaymentOpen(true)}>Документы оплаты</Button>}
          {canResync && <Button icon={<SyncOutlined />} loading={busy} onClick={resync}>Повторить синхронизацию</Button>}
          {canCreateOrder && (
            <Button icon={<ShopOutlined />} onClick={() => setCreateOrderOpen(true)}>Создать заказ поставщику</Button>
          )}
          {canSetSupplier && (
            <Button icon={<ShopOutlined />} onClick={() => setSupplierOpen(true)}>
              {r.order ? 'Изменить поставщика' : 'Выбрать поставщика'}
            </Button>
          )}
          {canPayStd && <Button icon={<DollarOutlined />} onClick={() => setPaymentOpen(true)}>Добавить оплату</Button>}
          {canRevisionStd && <Button icon={<RollbackOutlined />} onClick={() => setRevisionOpen(true)}>На доработку</Button>}
          {canRevisionComplete && <Button type="primary" loading={busy} onClick={completeRevision}>Отправить доработку</Button>}
          {canEditOrder && <Button icon={<EditOutlined />} onClick={() => setOrderEditOpen(true)}>Редактировать</Button>}
          {canEditItems && (
            <Button icon={<EditOutlined />} onClick={() => setItemsEditOpen(true)}>Изменить объёмы</Button>
          )}
          {canCancel && (
            <Popconfirm title="Отменить заявку?" okText="Отменить" cancelText="Нет"
              okButtonProps={{ danger: true }} onConfirm={cancelRequest}>
              <Button danger icon={<CloseCircleOutlined />} loading={busy}>Отменить</Button>
            </Popconfirm>
          )}
        </Space>
      </div>

      {/* Модалка: выбор поставщика (su10 / own_supply) */}
      <Modal title="Поставщик и сумма" open={supplierOpen} onCancel={() => setSupplierOpen(false)}
        onOk={submitSupplier} confirmLoading={busy} okText="Сохранить" width={modalWidth(520)}>
        <Form form={supForm} layout="vertical">
          <Form.Item name="supplierName" label="Поставщик" rules={[{ required: true, message: 'Укажите поставщика' }]}>
            <Input maxLength={300} />
          </Form.Item>
          <Form.Item name="supplierInn" label="ИНН" rules={[{ pattern: /^\d{10}(\d{2})?$/, message: 'ИНН 10 или 12 цифр' }]}>
            <Input maxLength={12} />
          </Form.Item>
          <Form.Item name="resultAmount" label="Сумма, ₽" rules={[{ required: true, message: 'Укажите сумму' }]}>
            <NumberInput preset="money" min={0.01} style={{ width: 220 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Заказ поставщику из su10-заявки: стандартная модалка заказа со всеми материалами заявки. */}
      {createOrderOpen && orderProjectId && (
        <SupplierOrderModal
          create={{ projectId: orderProjectId, rows: orderableMaterials }}
          onClose={() => setCreateOrderOpen(false)}
          onChanged={() => { invalidate(); qc.invalidateQueries({ queryKey: ['request-lots', id] }); }}
        />
      )}

      {/* Модалка: оплата */}
      <Modal title="Оплата" open={paymentOpen} onCancel={() => setPaymentOpen(false)}
        onOk={submitPayment} confirmLoading={busy} okText="Добавить" width={modalWidth(480)}>
        <Form form={payForm} layout="vertical">
          <Form.Item name="amount" label="Сумма, ₽" rules={[{ required: true, message: 'Укажите сумму' }]}>
            <NumberInput preset="money" min={0.01} style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="paidAt" label="Дата оплаты"><DatePicker style={{ width: 220 }} format="DD.MM.YYYY" /></Form.Item>
          <Form.Item name="docNumber" label="№ документа"><Input maxLength={100} /></Form.Item>
          <Form.Item name="comment" label="Комментарий"><Input.TextArea rows={2} maxLength={1000} /></Form.Item>
          {isOwnSupplier && (
            <Text type="secondary">Платёжный документ приложите в блоке «Документы» (тип «Платёжный документ»).</Text>
          )}
        </Form>
      </Modal>

      {/* Модалка: на доработку */}
      <Modal title="Отправить на доработку" open={revisionOpen} onCancel={() => setRevisionOpen(false)}
        onOk={submitRevision} confirmLoading={busy} okText="Отправить" width={modalWidth(480)}>
        <Form form={revForm} layout="vertical">
          <Form.Item name="comment" label="Что доработать" rules={[{ required: true, message: 'Укажите комментарий' }]}>
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Модалка: отправить РП (форма письма PayHub + QR) */}
      <RpSendModal
        open={rpSendOpen}
        requestId={id}
        expectedVersion={r.row_version}
        onClose={() => setRpSendOpen(false)}
        onDone={invalidate}
      />

      <RpFormModal open={rpFormOpen} requestId={id} requestNumber={r.number} onClose={() => setRpFormOpen(false)} />

      <OrderEditModal open={orderEditOpen} requestId={id} requestNumber={r.number} onClose={() => setOrderEditOpen(false)} />

      {itemsEditOpen && (
        <RequestItemsEditModal
          requestId={id}
          requestType={r.request_type}
          items={r.items}
          rowVersion={r.row_version}
          onClose={() => setItemsEditOpen(false)}
          onSaved={invalidate}
        />
      )}

      {preview && (
        <FilePreviewModal
          open onClose={() => setPreview(null)}
          requestId={id} fileId={preview.fileId} fileName={preview.fileName} mimeType={preview.mimeType}
        />
      )}
    </Card>
  );
}
