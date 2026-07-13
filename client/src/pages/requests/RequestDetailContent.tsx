import { useState } from 'react';
import {
  Card, Descriptions, Table, Space, Button, Tag, Empty, Timeline, Alert, Modal, Collapse,
  Form, Input, InputNumber, DatePicker, Typography, Spin, App, Popconfirm,
} from 'antd';
import {
  ArrowLeftOutlined, FileExcelOutlined, DownloadOutlined, EyeOutlined,
  DeleteOutlined, DollarOutlined, ShopOutlined, RollbackOutlined,
  FileDoneOutlined, SendOutlined, CloseCircleOutlined, SyncOutlined, LinkOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  REQUEST_DOC_TYPES, RP_APPLICATION_DOC_TYPES, REQUEST_DOC_TYPE_LABELS, type RequestDocType,
} from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { modalWidth } from '../../lib/modalWidth';
import { formatSize } from '../../lib/files';
import { RequestStatusTag, RequestTypeTag, money, round4 } from './requestConstants';
import { RpFormModal } from './RpFormModal';
import { RequestLotsSection } from './RequestLotsSection';
import { CommentsChat } from './CommentsChat';
import { FileUploadList, type UploadItem } from '../../components/files/FileUploadList';
import { FilePreviewModal } from '../../components/files/FilePreview';
import type { RequestDetail, RequestItem, RequestFile, RequestPayment } from './types';

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
  cancelled: 'Заявка отменена',
  file_added: 'Добавлен файл',
  file_removed: 'Удалён файл',
};

/**
 * Карточка заявки (стиль billhub ViewRequestModal): реквизиты + действия, затем секции-блоки
 * (Состав / Документы / Оплаты / История / Обсуждение). Предпросмотр файлов — всем ролям.
 */
export function RequestDetailContent({ id, onBack }: { id: string; onBack?: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isSupply = role === 'engineer' || role === 'admin' || role === 'manager';
  const isContractor = role === 'contractor';

  const [supplierOpen, setSupplierOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [rpFormOpen, setRpFormOpen] = useState(false);
  const [rpSendOpen, setRpSendOpen] = useState(false);
  const [docFiles, setDocFiles] = useState<UploadItem[]>([]);
  const [preview, setPreview] = useState<{ fileId: string; fileName: string; mimeType: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [supForm] = Form.useForm();
  const [payForm] = Form.useForm();
  const [revForm] = Form.useForm();
  const [rpSendForm] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['requests', 'detail', id],
    queryFn: () => api.get<{ data: RequestDetail }>(`/requests/${id}`),
    enabled: !!id,
  });
  const r = data?.data;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['requests', 'detail', id] });
    qc.invalidateQueries({ queryKey: ['requests', 'list'] });
    qc.invalidateQueries({ queryKey: ['requests', 'rp-registry'] });
    qc.invalidateQueries({ queryKey: ['requests', 'by-estimate'] });
    qc.invalidateQueries({ queryKey: ['material-requests'] });
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

  async function submitRpSend() {
    const v = await rpSendForm.validateFields();
    const ok = await mut(
      () => api.post(`/requests/${id}/rp-send`, {
        rpDate: v.rpDate.format('YYYY-MM-DD'),
        subject: v.subject || null,
        content: v.content || null,
        expectedVersion: r?.row_version,
      }),
      'РП отправлено, письмо создано в PayHub',
    )();
    if (ok) { setRpSendOpen(false); rpSendForm.resetFields(); }
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

  const canApplyRp = isContractor && isOwnSupplier && ['in_work', 'revision'].includes(r.status);
  const canCancel = (isContractor || isSupply) && isOwnSupplier && ['in_work', 'rp_forming', 'revision'].includes(r.status);
  const canSendRp = isSupply && isOwnSupplier && r.status === 'rp_forming';
  const canReviseRp = isSupply && isOwnSupplier && ['in_work', 'rp_forming'].includes(r.status);
  const canPayRp = isSupply && isOwnSupplier && ['rp_sent', 'rp_paid'].includes(r.status);
  const canResync = isSupply && isOwnSupplier && r.rp_letter?.sync_status === 'failed';

  const canEditFiles = isContractor && ['in_work', 'rp_forming', 'revision'].includes(r.status);
  // Удаление документов: подрядчик — до отправки РП; инженер/снабжение — на любом этапе (сервер разрешает internal).
  const canDeleteFiles = canEditFiles || isSupply;
  const canRevisionComplete = isContractor && !isOwnSupplier && r.status === 'revision';
  const canRevisionStd = isSupply && !isOwnSupplier && r.status === 'in_work';
  const canSetSupplier = (isSupply || (isContractor && isDirectRoute)) && !isOwnSupplier
    && r.status !== 'delivered' && r.status !== 'revision' && r.status !== 'cancelled';
  const canPayStd = isSupply && !isOwnSupplier && !!r.order && r.status !== 'delivered';
  const canUploadDocs = canEditFiles || isSupply;
  const uploadDocOptions = (isSupply ? REQUEST_DOC_TYPES : RP_APPLICATION_DOC_TYPES)
    .map((d) => ({ value: d, label: REQUEST_DOC_TYPE_LABELS[d as RequestDocType] }));

  const itemCols: ColumnsType<RequestItem> = [
    { title: '№', key: 'idx', width: 50, render: (_, __, i) => i + 1 },
    { title: 'Наименование', dataIndex: 'name', key: 'name' },
    { title: 'Ед.изм.', dataIndex: 'unit', key: 'unit', width: 90 },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'quantity', width: 110, align: 'right', render: (v) => round4(v) },
    { title: 'Вид работ', dataIndex: 'cost_type_name', key: 'cost_type_name', render: (v: string | null) => v || '—' },
  ];

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
    { title: 'Имя', dataIndex: 'file_name', key: 'file_name', ellipsis: true },
    { title: 'Размер', dataIndex: 'file_size', key: 'file_size', width: 90, render: (v: number | null) => formatSize(v) },
    { title: 'Загрузил', key: 'author', width: 190, render: (_, f) => (
      <div style={{ lineHeight: 1.2 }}>
        <div>{f.created_by_name || '—'}</div>
        <Text type="secondary" style={{ fontSize: 12 }}>{fileSide(f.created_by_role)}</Text>
      </div>
    ) },
    { title: '', key: 'act', width: 110, align: 'right', render: (_, f) => (
      <Space size={4}>
        <Button size="small" type="text" icon={<EyeOutlined />}
          onClick={() => setPreview({ fileId: f.id, fileName: f.file_name, mimeType: f.mime_type })} />
        <Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => downloadFile(f)} />
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
      key: 'items',
      label: `Состав заявки (${r.items.length})`,
      children: (
        <Table<RequestItem> rowKey={(_, i) => String(i)} size="small" pagination={false}
          columns={itemCols} dataSource={r.items} scroll={{ x: 600 }} />
      ),
    },
    ...(r.request_type === 'su10' && isSupply ? [{
      key: 'lots',
      label: 'Закупочные лоты',
      children: <RequestLotsSection requestId={id} />,
    }] : []),
    {
      key: 'files',
      label: `Документы (${r.files.length})`,
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {r.files.length === 0
            ? <Text type="secondary">Файлов нет</Text>
            : <Table<RequestFile> rowKey="id" size="small" pagination={false} columns={fileCols} dataSource={r.files} scroll={{ x: 560 }} />}
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
          {onBack && <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} />}
          <span>Заявка {r.number}</span>
          <RequestTypeTag type={r.request_type} />
          <RequestStatusTag status={r.status} comment={r.revision_reason} />
        </Space>
      }
      extra={<Button icon={<FileExcelOutlined />} onClick={exportExcel}>Экспорт в Excel</Button>}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ header: { paddingLeft: onBack ? 48 : 16 }, body: { flex: 1, minHeight: 0, overflow: 'auto' } }}
    >
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
              <a href={r.rp_letter.payhub_url} target="_blank" rel="noopener noreferrer">Открыть <LinkOutlined /></a>
            </Descriptions.Item>
          ) : null}
          <Descriptions.Item label="Создана">{new Date(r.created_at).toLocaleString('ru-RU')}</Descriptions.Item>
        </Descriptions>

        {/* Действия */}
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
          {canSetSupplier && (
            <Button icon={<ShopOutlined />} onClick={() => setSupplierOpen(true)}>
              {r.order ? 'Изменить поставщика' : 'Выбрать поставщика'}
            </Button>
          )}
          {canPayStd && <Button icon={<DollarOutlined />} onClick={() => setPaymentOpen(true)}>Добавить оплату</Button>}
          {canRevisionStd && <Button icon={<RollbackOutlined />} onClick={() => setRevisionOpen(true)}>На доработку</Button>}
          {canRevisionComplete && <Button type="primary" loading={busy} onClick={completeRevision}>Отправить доработку</Button>}
          {canCancel && <Button danger icon={<CloseCircleOutlined />} loading={busy} onClick={cancelRequest}>Отменить</Button>}
        </Space>

        <Collapse defaultActiveKey={['items', 'files', 'payments', 'history', 'chat']} items={sections} />
      </Space>

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
            <InputNumber min={0.01} precision={2} style={{ width: 220 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Модалка: оплата */}
      <Modal title="Оплата" open={paymentOpen} onCancel={() => setPaymentOpen(false)}
        onOk={submitPayment} confirmLoading={busy} okText="Добавить" width={modalWidth(480)}>
        <Form form={payForm} layout="vertical">
          <Form.Item name="amount" label="Сумма, ₽" rules={[{ required: true, message: 'Укажите сумму' }]}>
            <InputNumber min={0.01} precision={2} style={{ width: 220 }} />
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

      {/* Модалка: отправить РП */}
      <Modal title="Отправить РП" open={rpSendOpen} onCancel={() => setRpSendOpen(false)}
        onOk={submitRpSend} confirmLoading={busy} okText="Отправить в PayHub" width={modalWidth(520)}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="Будет создано распределительное письмо в PayHub; номер РП присвоит PayHub." />
        <Form form={rpSendForm} layout="vertical">
          <Form.Item name="rpDate" label="Дата РП" rules={[{ required: true, message: 'Укажите дату' }]}>
            <DatePicker style={{ width: 220 }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="subject" label="Тема письма"><Input maxLength={500} placeholder="РП" /></Form.Item>
          <Form.Item name="content" label="Описание"><Input.TextArea rows={3} maxLength={4000} placeholder="По умолчанию: сумма, поставщик, объект" /></Form.Item>
        </Form>
      </Modal>

      <RpFormModal open={rpFormOpen} requestId={id} requestNumber={r.number} onClose={() => setRpFormOpen(false)} />

      {preview && (
        <FilePreviewModal
          open onClose={() => setPreview(null)}
          requestId={id} fileId={preview.fileId} fileName={preview.fileName} mimeType={preview.mimeType}
        />
      )}
    </Card>
  );
}
