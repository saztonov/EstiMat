import { useEffect } from 'react';
import { Modal, Form, Select, InputNumber, Input } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';

interface Rate {
  id: string;
  name: string;
  code: string | null;
  unit: string;
  price: string;
}

interface Material {
  id: string;
  name: string;
  unit: string;
  unit_price: string;
}

export interface AddItemPayload {
  itemType: 'work' | 'material';
  rateId?: string;
  materialId?: string;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
}

interface Props {
  open: boolean;
  itemType: 'work' | 'material';
  onCancel: () => void;
  onSubmit: (payload: AddItemPayload) => void;
  loading?: boolean;
}

export function AddItemModal({ open, itemType, onCancel, onSubmit, loading }: Props) {
  const [form] = Form.useForm();

  const { data: rates } = useQuery({
    queryKey: ['rates'],
    queryFn: () => api.get<{ data: Rate[] }>('/rates'),
    enabled: open && itemType === 'work',
  });

  const { data: materials } = useQuery({
    queryKey: ['materials'],
    queryFn: () => api.get<{ data: Material[] }>('/materials'),
    enabled: open && itemType === 'material',
  });

  useEffect(() => {
    if (!open) form.resetFields();
    else form.setFieldsValue({ quantity: 1 });
  }, [open, form]);

  function onRateChange(rateId: string) {
    const rate = rates?.data.find((r) => r.id === rateId);
    if (rate) {
      form.setFieldsValue({
        description: rate.name,
        unit: rate.unit,
        unitPrice: Number(rate.price),
      });
    }
  }

  function onMaterialChange(materialId: string) {
    const mat = materials?.data.find((m) => m.id === materialId);
    if (mat) {
      form.setFieldsValue({
        description: mat.name,
        unit: mat.unit,
        unitPrice: Number(mat.unit_price ?? 0),
      });
    }
  }

  function onFinish(values: Record<string, unknown>) {
    onSubmit({
      itemType,
      rateId: itemType === 'work' ? (values.refId as string) : undefined,
      materialId: itemType === 'material' ? (values.refId as string) : undefined,
      description: values.description as string,
      unit: values.unit as string,
      quantity: Number(values.quantity),
      unitPrice: Number(values.unitPrice),
    });
  }

  const title = itemType === 'work' ? 'Добавить работу' : 'Добавить материал';
  const refLabel = itemType === 'work' ? 'Расценка' : 'Материал';

  const refOptions = itemType === 'work'
    ? rates?.data.map((r) => ({
        value: r.id,
        label: `${r.code ? `[${r.code}] ` : ''}${r.name} · ${r.unit} · ${Number(r.price).toLocaleString('ru-RU')} ₽`,
      }))
    : materials?.data.map((m) => ({
        value: m.id,
        label: `${m.name} · ${m.unit} · ${Number(m.unit_price ?? 0).toLocaleString('ru-RU')} ₽`,
      }));

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
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item
          name="refId"
          label={refLabel}
          rules={[{ required: true, message: `Выберите ${itemType === 'work' ? 'расценку' : 'материал'}` }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder={itemType === 'work' ? 'Выберите расценку' : 'Выберите материал'}
            options={refOptions}
            onChange={itemType === 'work' ? onRateChange : onMaterialChange}
          />
        </Form.Item>
        <Form.Item name="description" label="Наименование" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="unit" label="Ед. изм." rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="quantity" label="Количество" rules={[{ required: true, type: 'number', min: 0.0001 }]}>
          <InputNumber min={0} step={0.01} style={{ width: '100%' }} decimalSeparator="," />
        </Form.Item>
        <Form.Item name="unitPrice" label="Цена, ₽" rules={[{ required: true, type: 'number', min: 0 }]}>
          <InputNumber min={0} step={0.01} style={{ width: '100%' }} decimalSeparator="," />
        </Form.Item>
      </Form>
    </Modal>
  );
}
