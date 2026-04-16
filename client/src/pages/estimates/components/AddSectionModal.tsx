import { useEffect } from 'react';
import { Modal, Form, Select } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';

interface Category {
  id: string;
  name: string;
}

interface CostType {
  id: string;
  name: string;
  category_id: string;
}

export interface AddSectionPayload {
  costCategoryId: string;
  costTypeId: string;
}

interface Props {
  open: boolean;
  onCancel: () => void;
  onSubmit: (payload: AddSectionPayload) => void;
  loading?: boolean;
}

export function AddSectionModal({ open, onCancel, onSubmit, loading }: Props) {
  const [form] = Form.useForm<AddSectionPayload>();
  const categoryId = Form.useWatch('costCategoryId', form);

  const { data: categories } = useQuery({
    queryKey: ['rate-categories'],
    queryFn: () => api.get<{ data: Category[] }>('/rates/categories'),
    enabled: open,
  });

  const { data: types } = useQuery({
    queryKey: ['rate-types', categoryId],
    queryFn: () =>
      api.get<{ data: CostType[] }>(
        categoryId ? `/rates/types?categoryId=${categoryId}` : '/rates/types',
      ),
    enabled: open && !!categoryId,
  });

  useEffect(() => {
    if (!open) form.resetFields();
  }, [open, form]);

  return (
    <Modal
      title="Добавить раздел сметы"
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={loading}
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => onSubmit({ costCategoryId: v.costCategoryId, costTypeId: v.costTypeId })}
      >
        <Form.Item
          name="costCategoryId"
          label="Категория затрат"
          rules={[{ required: true, message: 'Выберите категорию' }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Выберите категорию затрат"
            onChange={() => form.setFieldValue('costTypeId', undefined)}
            options={categories?.data.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Form.Item>

        <Form.Item
          name="costTypeId"
          label="Вид затрат"
          rules={[{ required: true, message: 'Выберите вид затрат' }]}
          extra="Название раздела сформируется как «Категория / Вид затрат»"
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Выберите вид затрат"
            disabled={!categoryId}
            options={types?.data.map((t) => ({ value: t.id, label: t.name }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
