import { useEffect } from 'react';
import { Modal, Form, Select } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';

interface Rate {
  id: string;
  name: string;
  code: string | null;
  unit: string;
}

interface Props {
  open: boolean;
  onCancel: () => void;
  onSubmit: (rateId: string) => void;
  loading?: boolean;
}

export function AddSectionModal({ open, onCancel, onSubmit, loading }: Props) {
  const [form] = Form.useForm();

  const { data: rates } = useQuery({
    queryKey: ['rates'],
    queryFn: () => api.get<{ data: Rate[] }>('/rates'),
    enabled: open,
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
        onFinish={(v) => onSubmit(v.rateId)}
      >
        <Form.Item
          name="rateId"
          label="Расценка (вид работ)"
          rules={[{ required: true, message: 'Выберите расценку' }]}
          extra="Название раздела будет взято из расценки"
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Начните вводить название расценки"
            options={rates?.data.map((r) => ({
              value: r.id,
              label: `${r.code ? `[${r.code}] ` : ''}${r.name}`,
            }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
