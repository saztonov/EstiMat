import { useEffect, useState } from 'react';
import { Modal, Form, Input, Alert, App } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RP_APPLICATION_DOC_TYPES, REQUEST_DOC_TYPE_LABELS } from '@estimat/shared';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import { RequisitesFields } from './RequisitesFields';
import { FileUploadList, type UploadItem } from '../../components/files/FileUploadList';
import type { RequestDetail } from './types';

const DOC_TYPE_OPTIONS = RP_APPLICATION_DOC_TYPES.map((d) => ({ value: d, label: REQUEST_DOC_TYPE_LABELS[d] }));

interface Props {
  open: boolean;
  requestId: string;
  requestNumber?: string;
  onClose: () => void;
}

/**
 * Правка реквизитов оформленной заявки «Оплата по РП» (статус «Оформление РП»), без смены статуса.
 * Смена поставщика или суммы требует приложить новый счёт — прежний счёт вычёркивается на сервере.
 */
export function OrderEditModal({ open, requestId, requestNumber, onClose }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [showFileValidation, setShowFileValidation] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const detailQ = useQuery({
    queryKey: ['requests', 'detail', requestId],
    queryFn: () => api.get<{ data: RequestDetail }>(`/requests/${requestId}`),
    enabled: open && !!requestId,
  });
  const detail = detailQ.data?.data;
  const order = detail?.order;

  useEffect(() => {
    if (!open || !order) return;
    form.setFieldsValue({
      supplierId: order.supplier_id ?? undefined,
      supplierInn: order.supplier_inn ?? undefined,
      deliveryDays: order.delivery_days ?? undefined,
      deliveryDaysType: order.delivery_days_type ?? 'working',
      shippingConditions: order.shipping_conditions ?? undefined,
      invoiceAmount: order.amount != null ? Number(order.amount) : undefined,
      comment: order.rp_comment ?? undefined,
    });
  }, [open, order, form]);

  async function handleSubmit() {
    const v = await form.validateFields();
    const supplierChanged = !!order && v.supplierId !== order.supplier_id;
    const amountChanged = !!order && Number(v.invoiceAmount) !== Number(order.amount);
    const needInvoice = supplierChanged || amountChanged;
    if (needInvoice && !files.some((f) => f.docType === 'invoice')) {
      message.warning('При смене поставщика или суммы приложите новый счёт (тип «Счет»)');
      return;
    }
    if (files.some((f) => !f.docType)) {
      setShowFileValidation(true);
      message.warning('Укажите тип для каждого документа');
      return;
    }
    setSubmitting(true);
    try {
      // Загрузка приложенных документов; id нового счёта передаём для замены прежнего.
      let replacementInvoiceFileId: string | null = null;
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f.file);
        const resp = await api.upload<{ data: { id: string } }>(`/requests/${requestId}/files?docType=${f.docType}`, fd);
        if (f.docType === 'invoice') replacementInvoiceFileId = resp.data.id;
      }
      await api.patch(`/requests/${requestId}/order`, {
        supplierId: v.supplierId,
        deliveryDays: v.deliveryDays,
        deliveryDaysType: v.deliveryDaysType ?? 'working',
        shippingConditions: v.shippingConditions,
        invoiceAmount: v.invoiceAmount,
        comment: v.comment || null,
        replacementInvoiceFileId,
        expectedVersion: detail?.row_version ?? 0,
      });
      message.success('Реквизиты обновлены');
      qc.invalidateQueries({ queryKey: ['requests', 'detail', requestId] });
      qc.invalidateQueries({ queryKey: ['requests', 'list'] });
      qc.invalidateQueries({ queryKey: ['requests', 'by-estimate'] });
      qc.invalidateQueries({ queryKey: ['material-requests'] });
      setFiles([]);
      onClose();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={`Редактировать реквизиты${requestNumber ? ` — ${requestNumber}` : ''}`}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="Сохранить"
      confirmLoading={submitting}
      width={modalWidth(640)}
      styles={{ body: { maxHeight: 'calc(85vh - 140px)', overflowY: 'auto' } }}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="При смене поставщика или суммы приложите новый счёт — прежний счёт будет вычеркнут."
      />
      <Form form={form} layout="vertical" disabled={submitting}>
        <RequisitesFields
          form={form}
          currentSupplier={order?.supplier_id
            ? { id: order.supplier_id, name: order.supplier_name, inn: order.supplier_inn }
            : null}
        />
        <Form.Item label="Новый счёт (при смене поставщика/суммы)">
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
