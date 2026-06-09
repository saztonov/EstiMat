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

interface Organization {
  id: string;
  name: string;
  type?: string;
}

export interface CostTypeFormPayload {
  costCategoryId: string;
  costCategoryName: string;
  costTypeId: string;
  costTypeName: string;
  contractorId?: string | null;
}

interface Props {
  open: boolean;
  initialCategoryId?: string | null;
  onCancel: () => void;
  onSubmit: (payload: CostTypeFormPayload) => void;
  loading?: boolean;
}

export function AddCostTypeModal({ open, initialCategoryId, onCancel, onSubmit, loading }: Props) {
  const [form] = Form.useForm<{ costCategoryId: string; costTypeId: string; contractorId?: string }>();
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

  const { data: orgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<{ data: Organization[] }>('/organizations'),
    enabled: open,
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
      title="Добавить вид затрат"
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
            contractorId: v.contractorId ?? null,
          });
        }}
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
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Выберите вид затрат"
            disabled={!categoryId}
            options={types?.data.map((t) => ({ value: t.id, label: t.name }))}
          />
        </Form.Item>

        <Form.Item
          name="contractorId"
          label="Подрядчик (исполнитель вида затрат)"
          extra="Опционально — кто выполняет работы этого вида затрат"
        >
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Без подрядчика"
            options={orgs?.data
              .filter((o) => o.type === 'subcontractor' || o.type === 'general_contractor')
              .map((o) => ({ value: o.id, label: o.name }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
