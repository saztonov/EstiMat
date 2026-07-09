import { useMemo, useRef, useState } from 'react';
import {
  Modal, Form, Select, InputNumber, Input, Segmented, Upload, Button, Alert, Space, App,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';

interface Props {
  open: boolean;
  materialRequestId: string;
  materialRequestNumber: string;
  onClose: () => void;
}

interface RefResp<T> { data: T[]; meta: { stale: boolean; configured: boolean } }
interface Supplier { id: string; name: string; inn: string | null }
interface ShippingOption { id: string; value: string }
interface DocType { id: string; name: string }

function useRefs<T>(type: string, open: boolean) {
  return useQuery({
    queryKey: ['billhub-ref', type],
    queryFn: () => api.get<RefResp<T>>(`/payment-requests/references/${type}`),
    enabled: open,
  });
}

export function PaymentRequestModal({ open, materialRequestId, materialRequestNumber, onClose }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Клиентский ключ идемпотентности — стабилен на всё время жизни модалки (защита от двойного POST).
  const createRequestId = useRef(crypto.randomUUID());

  const suppliersQ = useRefs<Supplier>('suppliers', open);
  const shippingQ = useRefs<ShippingOption>('shipping', open);
  const docTypesQ = useRefs<DocType>('document-types', open);

  const configured = suppliersQ.data?.meta.configured ?? false;
  const supplierOptions = useMemo(
    () => (suppliersQ.data?.data ?? []).map((s) => ({
      value: s.id, label: s.inn ? `${s.name} (ИНН ${s.inn})` : s.name, supplier: s,
    })),
    [suppliersQ.data],
  );
  const shippingOptions = useMemo(
    () => (shippingQ.data?.data ?? []).map((s) => ({ value: s.id, label: s.value, opt: s })),
    [shippingQ.data],
  );

  async function handleSubmit() {
    const values = await form.validateFields();
    if (fileList.length === 0) {
      message.warning('Приложите счёт');
      return;
    }
    setSubmitting(true);
    try {
      const supplier = supplierOptions.find((o) => o.value === values.supplierId)?.supplier;
      const shipping = shippingOptions.find((o) => o.value === values.shippingConditionId)?.opt;

      // 1. Черновик заявки на оплату (идемпотентно по createRequestId).
      const created = await api.post<{ data: { id: string } }>('/payment-requests', {
        materialRequestId,
        createRequestId: createRequestId.current,
        bhSupplierId: supplier?.id ?? null,
        bhSupplierName: supplier?.name ?? null,
        bhSupplierInn: supplier?.inn ?? null,
        bhShippingConditionId: shipping?.id ?? null,
        bhShippingConditionValue: shipping?.value ?? null,
        deliveryDays: values.deliveryDays ?? null,
        deliveryDaysType: values.deliveryDaysType ?? 'working',
        invoiceAmount: values.invoiceAmount ?? null,
        comment: values.comment ?? null,
      });
      const id = created.data.id;

      // 2. Загрузка счёта (файлов).
      for (const f of fileList) {
        const fd = new FormData();
        fd.append('file', f.originFileObj as File);
        if (values.documentTypeId) fd.append('documentTypeId', values.documentTypeId);
        await api.upload(`/payment-requests/${id}/files`, fd);
      }

      // 3. Отправка (запись команды в очередь + fast-path).
      const submitted = await api.post<{ data: { syncState: string } }>(
        `/payment-requests/${id}/submit`,
      );
      if (submitted.data.syncState === 'queued') {
        message.success('Заявка на оплату отправлена в BillHub');
      } else {
        message.success('Заявка сохранена; отправится в BillHub после включения интеграции');
      }
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      onClose();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={`Заявка на оплату — на основе ${materialRequestNumber}`}
      open={open}
      onCancel={onClose}
      okText="Создать и отправить"
      confirmLoading={submitting}
      onOk={handleSubmit}
      okButtonProps={{ disabled: !configured }}
      width={modalWidth(640)}
    >
      {!configured && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Интеграция с BillHub не настроена"
          description="Справочники поставщиков недоступны — оформить заявку на оплату пока нельзя. Обратитесь к администратору."
        />
      )}
      <Form form={form} layout="vertical" disabled={!configured || submitting}>
        <Form.Item
          name="supplierId"
          label="Поставщик"
          rules={[{ required: true, message: 'Выберите поставщика' }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            loading={suppliersQ.isLoading}
            options={supplierOptions}
            placeholder="Поставщик из справочника BillHub"
          />
        </Form.Item>
        <Form.Item
          name="shippingConditionId"
          label="Условия отгрузки"
          rules={[{ required: true, message: 'Выберите условия отгрузки' }]}
        >
          <Select loading={shippingQ.isLoading} options={shippingOptions} placeholder="Условия отгрузки" />
        </Form.Item>
        <Form.Item label="Срок поставки" required style={{ marginBottom: 0 }}>
          <Space align="start">
            <Form.Item name="deliveryDays" rules={[{ required: true, message: 'Укажите срок' }]} noStyle>
              <InputNumber min={1} placeholder="дней" style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="deliveryDaysType" initialValue="working" noStyle>
              <Segmented
                options={[
                  { value: 'working', label: 'рабочих' },
                  { value: 'calendar', label: 'календарных' },
                ]}
              />
            </Form.Item>
          </Space>
        </Form.Item>
        <Form.Item
          name="invoiceAmount"
          label="Сумма счёта, ₽"
          rules={[{ required: true, message: 'Укажите сумму счёта' }]}
          style={{ marginTop: 16 }}
        >
          <InputNumber min={0.01} style={{ width: 220 }} precision={2} />
        </Form.Item>
        <Form.Item name="documentTypeId" label="Тип документа (для счёта)">
          <Select
            allowClear
            loading={docTypesQ.isLoading}
            options={(docTypesQ.data?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
            placeholder="Необязательно"
          />
        </Form.Item>
        <Form.Item label="Счёт (файл)" required>
          <Upload
            beforeUpload={() => false}
            fileList={fileList}
            onChange={({ fileList: fl }) => setFileList(fl)}
            maxCount={5}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.bmp"
          >
            <Button icon={<UploadOutlined />}>Прикрепить счёт</Button>
          </Upload>
        </Form.Item>
        <Form.Item name="comment" label="Комментарий">
          <Input.TextArea rows={2} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
