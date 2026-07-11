import { useState } from 'react';
import {
  Card, Descriptions, Table, Space, Button, Tag, Empty, Timeline, Alert, Modal,
  Form, Input, InputNumber, Select, Upload, App, Typography, Spin,
} from 'antd';
import {
  ArrowLeftOutlined, FileExcelOutlined, DownloadOutlined, UploadOutlined,
  DeleteOutlined, DollarOutlined, ShopOutlined, RollbackOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { REQUEST_DOC_TYPES, REQUEST_DOC_TYPE_LABELS, type RequestDocType } from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { modalWidth } from '../../lib/modalWidth';
import { RequestStatusTag, RequestTypeTag, money, round4 } from './requestConstants';
import type { RequestDetail, RequestItem, RequestFile, RequestPayment } from './types';

const { Text, Title } = Typography;

const ACTION_LABELS: Record<string, string> = {
  created: 'Заявка создана',
  status_changed: 'Статус изменён',
  supplier_selected: 'Выбран поставщик',
  payment_added: 'Добавлена оплата',
  revision_requested: 'Отправлена на доработку',
  revision_completed: 'Доработка завершена',
  file_added: 'Добавлен файл',
  file_removed: 'Удалён файл',
};

/**
 * Карточка заявки — переиспользуется страницей /requests/:id и вложенной модалкой
 * «Открыть» из списка «Созданные заявки». Данные тянутся по id через react-query,
 * поэтому одинаково работают и на странице, и в модалке. Кнопка «назад» рендерится
 * только при переданном onBack (на странице — навигация, в модалке — закрытие).
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
  const [docType, setDocType] = useState<RequestDocType>('invoice');
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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['requests', 'detail', id] });
    qc.invalidateQueries({ queryKey: ['requests', 'list'] });
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
        resultAmount: v.resultAmount, rpNumber: v.rpNumber || null,
        expectedVersion: r?.row_version,
      }),
      'Поставщик сохранён',
    )();
    if (ok) { setSupplierOpen(false); supForm.resetFields(); }
  }

  async function submitPayment() {
    const v = await payForm.validateFields();
    const ok = await mut(
      () => api.post(`/requests/${id}/payments`, {
        amount: v.amount, paidAt: v.paidAt || null, docNumber: v.docNumber || null, comment: v.comment || null,
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

  const completeRevision = mut(
    () => api.post(`/requests/${id}/revision-complete`, {}),
    'Отправлено на проверку',
  );

  async function uploadFile(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.upload(`/requests/${id}/files?docType=${docType}`, fd);
      message.success('Файл загружен');
      invalidate();
    } catch (e) { message.error((e as Error).message); }
    finally { setBusy(false); }
  }

  const deleteFile = (fileId: string) => mut(
    () => api.delete(`/requests/${id}/files/${fileId}`),
    'Файл удалён',
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

  const canEditFiles = isContractor && ['in_work', 'revision'].includes(r.status);
  const canRevisionComplete = isContractor && r.status === 'revision';
  const canRevision = isSupply && r.status === 'in_work';
  const isDirectRoute = r.request_type === 'own_supplier' || r.request_type === 'own_supply';
  const canSetSupplier = (isSupply || (isContractor && isDirectRoute)) && r.status !== 'delivered' && r.status !== 'revision';
  const canPay = isSupply && !!r.order && r.status !== 'delivered';

  const itemCols: ColumnsType<RequestItem> = [
    { title: '№', key: 'idx', width: 50, render: (_, __, i) => i + 1 },
    { title: 'Наименование', dataIndex: 'name', key: 'name' },
    { title: 'Ед.изм.', dataIndex: 'unit', key: 'unit', width: 90 },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'quantity', width: 110, align: 'right', render: (v) => round4(v) },
    { title: 'Вид работ', dataIndex: 'cost_type_name', key: 'cost_type_name', render: (v: string | null) => v || '—' },
  ];

  const payCols: ColumnsType<RequestPayment> = [
    { title: 'Сумма', dataIndex: 'amount', key: 'amount', align: 'right', render: (v) => money(v) },
    { title: 'Дата', dataIndex: 'paid_at', key: 'paid_at', render: (v: string | null) => v ? new Date(v).toLocaleDateString('ru-RU') : '—' },
    { title: '№ документа', dataIndex: 'doc_number', key: 'doc_number', render: (v: string | null) => v || '—' },
    { title: 'Комментарий', dataIndex: 'comment', key: 'comment', render: (v: string | null) => v || '—' },
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

        <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
          <Descriptions.Item label="Объект">{r.project_name || '—'}</Descriptions.Item>
          <Descriptions.Item label="Смета">{r.estimate_label || '—'}</Descriptions.Item>
          <Descriptions.Item label="Поставщик">
            {r.order?.supplier_name || r.supplier_name || '—'}
            {r.order?.supplier_inn ? `, ИНН ${r.order.supplier_inn}` : ''}
          </Descriptions.Item>
          <Descriptions.Item label="Сумма заказа">{money(r.order?.amount ?? r.order_amount)}</Descriptions.Item>
          {r.rp_number || r.order?.rp_number ? (
            <Descriptions.Item label="РП">{r.order?.rp_number || r.rp_number}</Descriptions.Item>
          ) : null}
          <Descriptions.Item label="Создана">{new Date(r.created_at).toLocaleString('ru-RU')}</Descriptions.Item>
        </Descriptions>

        {/* Действия */}
        <Space wrap>
          {canSetSupplier && (
            <Button icon={<ShopOutlined />} onClick={() => setSupplierOpen(true)}>
              {r.order ? 'Изменить поставщика' : 'Выбрать поставщика'}
            </Button>
          )}
          {canPay && <Button icon={<DollarOutlined />} onClick={() => setPaymentOpen(true)}>Добавить оплату</Button>}
          {canRevision && <Button icon={<RollbackOutlined />} onClick={() => setRevisionOpen(true)}>На доработку</Button>}
          {canRevisionComplete && (
            <Button type="primary" loading={busy} onClick={completeRevision}>Отправить доработку</Button>
          )}
        </Space>

        {/* Позиции */}
        <div>
          <Text strong>Состав заявки</Text>
          <Table<RequestItem>
            rowKey={(_, i) => String(i)} size="small" pagination={false}
            columns={itemCols} dataSource={r.items} scroll={{ x: 600 }} style={{ marginTop: 8 }}
          />
        </div>

        {/* Файлы */}
        <div>
          <Space style={{ marginBottom: 8 }}>
            <Text strong>Документы</Text>
            {(canEditFiles || isSupply) && (
              <>
                <Select
                  size="small" style={{ width: 160 }} value={docType} onChange={setDocType}
                  options={REQUEST_DOC_TYPES.map((d) => ({ value: d, label: REQUEST_DOC_TYPE_LABELS[d] }))}
                />
                <Upload
                  showUploadList={false}
                  beforeUpload={(file) => { uploadFile(file as File); return false; }}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.bmp"
                >
                  <Button size="small" icon={<UploadOutlined />} loading={busy}>Добавить файл</Button>
                </Upload>
              </>
            )}
          </Space>
          {r.files.length === 0 ? (
            <Text type="secondary">Файлов нет</Text>
          ) : (
            <Table<RequestFile>
              rowKey="id" size="small" pagination={false} showHeader={false}
              columns={[
                { title: 'Тип', dataIndex: 'doc_type', key: 'doc_type', width: 150,
                  render: (v: string) => <Tag>{REQUEST_DOC_TYPE_LABELS[v as RequestDocType] ?? v}</Tag> },
                { title: 'Имя', dataIndex: 'file_name', key: 'file_name' },
                { title: '', key: 'act', width: 90, align: 'right', render: (_, f) => (
                  <Space size={4}>
                    <Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => downloadFile(f)} />
                    {canEditFiles && (
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={deleteFile(f.id)} />
                    )}
                  </Space>
                ) },
              ]}
              dataSource={r.files}
            />
          )}
        </div>

        {/* Оплаты */}
        {r.payments.length > 0 && (
          <div>
            <Text strong>Оплаты</Text>
            <Table<RequestPayment> rowKey="id" size="small" pagination={false}
              columns={payCols} dataSource={r.payments} style={{ marginTop: 8 }} />
          </div>
        )}

        {/* История */}
        {r.history.length > 0 && (
          <div>
            <Text strong>История</Text>
            <Timeline
              style={{ marginTop: 12 }}
              items={r.history.map((h) => ({
                children: (
                  <Space direction="vertical" size={0}>
                    <Text>{ACTION_LABELS[h.action] ?? h.action}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {h.actor_name || 'Система'} · {new Date(h.created_at).toLocaleString('ru-RU')}
                    </Text>
                  </Space>
                ),
              }))}
            />
          </div>
        )}
      </Space>

      {/* Модалка: выбор поставщика */}
      <Modal
        title="Поставщик и сумма" open={supplierOpen} onCancel={() => setSupplierOpen(false)}
        onOk={submitSupplier} confirmLoading={busy} okText="Сохранить" width={modalWidth(520)}
      >
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
          {r.request_type === 'own_supplier' && (
            <Form.Item name="rpNumber" label="Номер РП"><Input maxLength={100} /></Form.Item>
          )}
        </Form>
      </Modal>

      {/* Модалка: оплата */}
      <Modal
        title="Оплата" open={paymentOpen} onCancel={() => setPaymentOpen(false)}
        onOk={submitPayment} confirmLoading={busy} okText="Добавить" width={modalWidth(480)}
      >
        <Form form={payForm} layout="vertical">
          <Form.Item name="amount" label="Сумма, ₽" rules={[{ required: true, message: 'Укажите сумму' }]}>
            <InputNumber min={0.01} precision={2} style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="docNumber" label="№ документа"><Input maxLength={100} /></Form.Item>
          <Form.Item name="comment" label="Комментарий"><Input.TextArea rows={2} maxLength={1000} /></Form.Item>
        </Form>
      </Modal>

      {/* Модалка: на доработку */}
      <Modal
        title="Отправить на доработку" open={revisionOpen} onCancel={() => setRevisionOpen(false)}
        onOk={submitRevision} confirmLoading={busy} okText="Отправить" width={modalWidth(480)}
      >
        <Form form={revForm} layout="vertical">
          <Form.Item name="comment" label="Что доработать" rules={[{ required: true, message: 'Укажите комментарий' }]}>
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
