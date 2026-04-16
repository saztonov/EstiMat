import { useEffect } from 'react';
import { Modal, Form, Select, Input } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';

interface Category {
  id: string;
  name: string;
}

export interface EditEstimatePayload {
  costCategoryId: string | null;
  workType: string | null;
  notes: string | null;
}

interface Props {
  open: boolean;
  initialValues?: Partial<EditEstimatePayload>;
  onCancel: () => void;
  onSubmit: (payload: EditEstimatePayload) => void;
  loading?: boolean;
}

export function EditEstimateModal({
  open,
  initialValues,
  onCancel,
  onSubmit,
  loading,
}: Props) {
  const [form] = Form.useForm<EditEstimatePayload>();

  const { data: categories } = useQuery({
    queryKey: ['rate-categories'],
    queryFn: () => api.get<{ data: Category[] }>('/rates/categories'),
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      form.resetFields();
    } else if (initialValues) {
      form.setFieldsValue(initialValues);
    }
  }, [open, initialValues, form]);

  return (
    <Modal
      title="Редактировать смету"
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={loading}
      width={600}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) =>
          onSubmit({
            costCategoryId: v.costCategoryId ?? null,
            workType: v.workType ?? null,
            notes: v.notes ?? null,
          })
        }
      >
        <Form.Item name="costCategoryId" label="Категория затрат">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Выберите категорию затрат"
            options={categories?.data.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Form.Item>
        <Form.Item name="workType" label="Работы">
          <Input placeholder="Например: Отделка, Черновые работы" />
        </Form.Item>
        <Form.Item name="notes" label="Примечания">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
