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

export interface SectionFormPayload {
  costCategoryId: string;
  costTypeId: string;
  contractorId?: string | null;
}

interface Props {
  open: boolean;
  mode?: 'create' | 'edit';
  initialValues?: Partial<SectionFormPayload>;
  onCancel: () => void;
  onSubmit: (payload: SectionFormPayload) => void;
  loading?: boolean;
}

// Legacy alias — сохранён для минимальной правки импортов
export type AddSectionPayload = SectionFormPayload;

export function AddSectionModal({
  open,
  mode = 'create',
  initialValues,
  onCancel,
  onSubmit,
  loading,
}: Props) {
  const [form] = Form.useForm<SectionFormPayload>();
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
    } else if (initialValues) {
      form.setFieldsValue(initialValues);
    }
  }, [open, initialValues, form]);

  const title = mode === 'edit' ? 'Редактировать раздел' : 'Добавить раздел сметы';

  return (
    <Modal
      title={title}
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
            costCategoryId: v.costCategoryId,
            costTypeId: v.costTypeId,
            contractorId: v.contractorId ?? null,
          })
        }
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

        <Form.Item
          name="contractorId"
          label="Подрядчик (исполнитель раздела)"
          extra="Опционально — кто выполняет работы этого раздела"
        >
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Без подрядчика"
            options={orgs?.data
              .filter(
                (o) => o.type === 'subcontractor' || o.type === 'general_contractor',
              )
              .map((o) => ({ value: o.id, label: o.name }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
