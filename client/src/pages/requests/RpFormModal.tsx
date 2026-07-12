import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Form, Select, InputNumber, Input, Segmented, Collapse, Table, Space, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SHIPPING_CONDITIONS, RP_APPLICATION_DOC_TYPES, REQUEST_DOC_TYPE_LABELS } from '@estimat/shared';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import { round4 } from './requestConstants';
import { FileUploadList, type UploadItem } from '../../components/files/FileUploadList';
import type { RequestDetail, RequestItem } from './types';

interface Supplier {
  id: string;
  name: string;
  inn: string | null;
}

interface Props {
  open: boolean;
  requestId: string;
  requestNumber?: string;
  onClose: () => void;
  /** Вызывается после успешного оформления (для закрытия внешней модалки-развилки). */
  onDone?: () => void;
}

const DOC_TYPE_OPTIONS = RP_APPLICATION_DOC_TYPES.map((d) => ({ value: d, label: REQUEST_DOC_TYPE_LABELS[d] }));

/**
 * Форма «Оформить РП» (подрядчик): свёрнутый список материалов + реквизиты заявки на оплату
 * в стиле billhub. Поставщик из справочника; условия отгрузки — типовой список; документы —
 * drag-n-drop с типом на каждый файл (счёт обязателен).
 */
export function RpFormModal({ open, requestId, requestNumber, onClose, onDone }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [showFileValidation, setShowFileValidation] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const createRequestId = useRef(crypto.randomUUID());

  const detailQ = useQuery({
    queryKey: ['requests', 'detail', requestId],
    queryFn: () => api.get<{ data: RequestDetail }>(`/requests/${requestId}`),
    enabled: open && !!requestId,
  });
  const detail = detailQ.data?.data;

  const suppliersQ = useQuery({
    queryKey: ['suppliers', supplierSearch],
    queryFn: () => api.get<{ data: Supplier[] }>(`/suppliers?q=${encodeURIComponent(supplierSearch)}`),
    enabled: open,
  });
  const supplierOptions = useMemo(
    () => (suppliersQ.data?.data ?? []).map((s) => ({
      value: s.id,
      label: s.inn ? `${s.name} (ИНН ${s.inn})` : s.name,
      supplier: s,
    })),
    [suppliersQ.data],
  );

  // Префилл реквизитов при дооформлении (после доработки).
  useEffect(() => {
    if (!open || !detail?.order) return;
    const o = detail.order;
    form.setFieldsValue({
      supplierId: o.supplier_id ?? undefined,
      supplierInn: o.supplier_inn ?? undefined,
      deliveryDays: o.delivery_days ?? undefined,
      deliveryDaysType: o.delivery_days_type ?? 'working',
      shippingConditions: o.shipping_conditions ?? undefined,
      invoiceAmount: o.amount != null ? Number(o.amount) : undefined,
      comment: o.rp_comment ?? undefined,
    });
  }, [open, detail?.order, form]);

  const itemCols: ColumnsType<RequestItem> = [
    { title: '№', key: 'idx', width: 44, render: (_, __, i) => i + 1 },
    { title: 'Наименование', dataIndex: 'name', key: 'name' },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'quantity', width: 100, align: 'right', render: (v) => round4(v) },
  ];

  async function handleSubmit() {
    const v = await form.validateFields();
    // Валидация документов: у каждого файла — тип; должен быть приложен счёт.
    if (files.length === 0 || !files.some((f) => f.docType === 'invoice')) {
      message.warning('Приложите счёт (тип «Счет»)');
      return;
    }
    if (files.some((f) => !f.docType)) {
      setShowFileValidation(true);
      message.warning('Укажите тип для каждого документа');
      return;
    }
    setSubmitting(true);
    try {
      // 1. Загрузка документов с их типами.
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f.file);
        await api.upload(`/requests/${requestId}/files?docType=${f.docType}`, fd);
      }
      // 2. Оформление РП → статус «Оформление РП».
      await api.post(`/requests/${requestId}/rp-application`, {
        supplierId: v.supplierId,
        deliveryDays: v.deliveryDays,
        deliveryDaysType: v.deliveryDaysType ?? 'working',
        shippingConditions: v.shippingConditions,
        invoiceAmount: v.invoiceAmount,
        comment: v.comment || null,
        expectedVersion: detail?.row_version ?? 0,
        createRequestId: createRequestId.current,
      });
      message.success('Заявка отправлена на оформление РП');
      qc.invalidateQueries({ queryKey: ['requests', 'detail', requestId] });
      qc.invalidateQueries({ queryKey: ['requests', 'list'] });
      qc.invalidateQueries({ queryKey: ['requests', 'by-estimate'] });
      qc.invalidateQueries({ queryKey: ['material-requests'] });
      setFiles([]);
      onClose();
      onDone?.();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const items = detail?.items ?? [];

  return (
    <Modal
      title={`Оформить РП${requestNumber ? ` — ${requestNumber}` : ''}`}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="Отправить на РП"
      confirmLoading={submitting}
      width={modalWidth(640)}
      styles={{ body: { maxHeight: 'calc(85vh - 140px)', overflowY: 'auto' } }}
      destroyOnClose
    >
      <Collapse
        size="small"
        style={{ marginBottom: 16 }}
        items={[
          {
            key: 'materials',
            label: `Материалы заявки (${items.length})`,
            children: (
              <Table<RequestItem>
                rowKey={(_, i) => String(i)}
                size="small"
                pagination={false}
                columns={itemCols}
                dataSource={items}
                scroll={{ x: 480 }}
              />
            ),
          },
        ]}
      />
      <Form form={form} layout="vertical" disabled={submitting}>
        <Form.Item name="supplierId" label="Поставщик" rules={[{ required: true, message: 'Выберите поставщика' }]}>
          <Select
            showSearch
            filterOption={false}
            onSearch={setSupplierSearch}
            loading={suppliersQ.isLoading}
            options={supplierOptions}
            placeholder="Поиск по названию или ИНН"
            onChange={(val) => {
              const s = supplierOptions.find((o) => o.value === val)?.supplier;
              form.setFieldValue('supplierInn', s?.inn ?? '');
            }}
          />
        </Form.Item>
        <Form.Item name="supplierInn" label="ИНН поставщика">
          <Input disabled placeholder="Заполнится из справочника" />
        </Form.Item>
        <Form.Item label="Срок поставки" required style={{ marginBottom: 8 }}>
          <Space align="start">
            <Form.Item name="deliveryDays" rules={[{ required: true, message: 'Укажите срок' }]} noStyle>
              <InputNumber min={1} placeholder="дней" style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="deliveryDaysType" initialValue="working" noStyle>
              <Segmented options={[{ value: 'working', label: 'рабочих' }, { value: 'calendar', label: 'календарных' }]} />
            </Form.Item>
          </Space>
        </Form.Item>
        <Form.Item name="shippingConditions" label="Условия отгрузки" rules={[{ required: true, message: 'Выберите условия отгрузки' }]}>
          <Select
            placeholder="Выберите условия"
            options={SHIPPING_CONDITIONS.map((c) => ({ value: c, label: c }))}
          />
        </Form.Item>
        <Form.Item name="invoiceAmount" label="Сумма счёта, ₽" rules={[{ required: true, message: 'Укажите сумму счёта' }]}>
          <InputNumber min={0.01} precision={2} style={{ width: 220 }} />
        </Form.Item>
        <Form.Item label="Документы" required tooltip="Обязательно приложите счёт">
          <FileUploadList
            value={files}
            onChange={setFiles}
            docTypeOptions={DOC_TYPE_OPTIONS}
            showValidation={showFileValidation}
          />
        </Form.Item>
        <Form.Item name="comment" label="Комментарий">
          <Input.TextArea rows={2} maxLength={2000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
