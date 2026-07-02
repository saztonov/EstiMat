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

export interface CostTypeFormPayload {
  costCategoryId: string;
  costCategoryName: string;
  costTypeId: string;
  costTypeName: string;
}

interface Props {
  open: boolean;
  initialCategoryId?: string | null;
  onCancel: () => void;
  onSubmit: (payload: CostTypeFormPayload) => void;
  loading?: boolean;
}

export function AddCostTypeModal({ open, initialCategoryId, onCancel, onSubmit, loading }: Props) {
  const [form] = Form.useForm<{ costCategoryId: string; costTypeId: string }>();
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
    if (!open) {
      form.resetFields();
    } else if (initialCategoryId) {
      form.setFieldsValue({ costCategoryId: initialCategoryId });
    }
  }, [open, initialCategoryId, form]);

  return (
    <Modal
      title="Добавить вид работ"
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
        onFinish={(v) => {
          const cat = categories?.data.find((c) => c.id === v.costCategoryId);
          const type = types?.data.find((t) => t.id === v.costTypeId);
          onSubmit({
            costCategoryId: v.costCategoryId,
            costCategoryName: cat?.name ?? '',
            costTypeId: v.costTypeId,
            costTypeName: type?.name ?? '',
          });
        }}
      >
        <Form.Item
          name="costCategoryId"
          label="Категория"
          rules={[{ required: true, message: 'Выберите категорию' }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Выберите категорию"
            onChange={() => form.setFieldValue('costTypeId', undefined)}
            options={categories?.data.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Form.Item>

        <Form.Item
          name="costTypeId"
          label="Вид работ"
          rules={[{ required: true, message: 'Выберите вид работ' }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Выберите вид работ"
            disabled={!categoryId}
            options={types?.data.map((t) => ({ value: t.id, label: t.name }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
