import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Table, Button, Modal, Form, Input, Select, Tag, Space, Upload, App } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile, UploadProps } from 'antd/es/upload/interface';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { PROJECT_STATUS_LABELS } from '@estimat/shared';

const statusColors: Record<string, string> = {
  planning: 'blue',
  active: 'green',
  completed: 'default',
  archived: 'orange',
};

type ProjectRow = Record<string, unknown> & {
  id: string;
  code: string;
  name: string;
  full_name: string | null;
  org_id: string;
  address: string | null;
  image_url: string | null;
  status: string;
};

type FormMode = { type: 'create' } | { type: 'edit'; project: ProjectRow };

export function ProjectsPanel() {
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ data: ProjectRow[] }>('/projects'),
  });

  const columns: ColumnsType<ProjectRow> = [
    { title: 'Код', dataIndex: 'code', width: 100 },
    { title: 'Название', dataIndex: 'name' },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 140,
      render: (status: string) => (
        <Tag color={statusColors[status]}>{PROJECT_STATUS_LABELS[status as keyof typeof PROJECT_STATUS_LABELS] || status}</Tag>
      ),
    },
    { title: 'Адрес', dataIndex: 'address', ellipsis: true },
    {
      title: '',
      key: 'actions',
      width: 56,
      render: (_, record) => (
        <Button
          type="text"
          icon={<EditOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            setFormMode({ type: 'edit', project: record });
          }}
        />
      ),
    },
  ];

  return (
    <div className="table-page-wrapper">
      <Space style={{ marginBottom: 16, flexShrink: 0 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setFormMode({ type: 'create' })}>Создать</Button>
      </Space>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data?.data}
        loading={isLoading}
        scroll={{ y: 'flex' }}
        onRow={(record) => ({ onClick: () => navigate(`/projects/${record.id}`) })}
        style={{ cursor: 'pointer' }}
      />

      {formMode ? (
        <ProjectFormModal
          mode={formMode}
          onClose={() => setFormMode(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            queryClient.invalidateQueries({ queryKey: ['projects-with-stats'] });
          }}
        />
      ) : null}
    </div>
  );
}

interface ProjectFormModalProps {
  mode: FormMode;
  onClose: () => void;
  onSuccess: () => void;
}

function ProjectFormModal({ mode, onClose, onSuccess }: ProjectFormModalProps) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const isEdit = mode.type === 'edit';

  const { data: orgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<{ data: Record<string, unknown>[] }>('/organizations'),
  });

  const [fileList, setFileList] = useState<UploadFile[]>(() =>
    isEdit && mode.project.image_url
      ? [{ uid: '-1', name: 'photo', status: 'done', url: mode.project.image_url }]
      : [],
  );
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (isEdit) {
      form.setFieldsValue({
        code: mode.project.code,
        name: mode.project.name,
        fullName: mode.project.full_name,
        orgId: mode.project.org_id,
        address: mode.project.address,
        imageUrl: mode.project.image_url,
      });
    } else {
      form.resetFields();
    }
  }, [form, isEdit, mode]);

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      if (isEdit) {
        return api.put(`/projects/${mode.project.id}`, values);
      }
      return api.post('/projects', values);
    },
    onSuccess: () => {
      message.success(isEdit ? 'Проект обновлён' : 'Проект создан');
      onSuccess();
      onClose();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const customRequest: UploadProps['customRequest'] = async ({ file, onSuccess: onUpSuccess, onError }) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file as File);
      const res = await api.upload<{ url: string }>('/uploads/image', fd);
      form.setFieldValue('imageUrl', res.url);
      onUpSuccess?.(res);
    } catch (err) {
      message.error((err as Error).message);
      onError?.(err as Error);
    } finally {
      setUploading(false);
    }
  };

  const handleChange: UploadProps['onChange'] = ({ fileList: fl }) => {
    const next = fl.slice(-1).map((f) => {
      if (f.response && typeof (f.response as { url?: string }).url === 'string') {
        return { ...f, url: (f.response as { url: string }).url };
      }
      return f;
    });
    setFileList(next);
  };

  const handleRemove: UploadProps['onRemove'] = () => {
    form.setFieldValue('imageUrl', null);
    setFileList([]);
    return true;
  };

  return (
    <Modal
      title={isEdit ? 'Редактирование проекта' : 'Новый проект'}
      open
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saveMutation.isPending || uploading}
      okButtonProps={{ disabled: uploading }}
    >
      <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)}>
        <Form.Item name="code" label="Код (3-6 символов)" rules={[{ required: true, min: 3, max: 6 }]}>
          <Input placeholder="СОБ62" />
        </Form.Item>
        <Form.Item name="name" label="Название" rules={[{ required: true }]}>
          <Input placeholder="ЖК Солнечный" />
        </Form.Item>
        <Form.Item name="fullName" label="Полное название">
          <Input />
        </Form.Item>
        <Form.Item name="orgId" label="Организация" rules={[{ required: true }]}>
          <Select
            placeholder="Выберите организацию"
            options={orgs?.data.map((o) => ({ value: o.id as string, label: o.name as string }))}
          />
        </Form.Item>
        <Form.Item name="address" label="Адрес">
          <Input />
        </Form.Item>
        <Form.Item name="imageUrl" label="Фото объекта" hidden>
          <Input />
        </Form.Item>
        <Form.Item label="Фото объекта">
          <Upload
            listType="picture-card"
            maxCount={1}
            accept="image/jpeg,image/png,image/webp"
            fileList={fileList}
            customRequest={customRequest}
            onChange={handleChange}
            onRemove={handleRemove}
          >
            {fileList.length === 0 ? (
              <div>
                <PlusOutlined />
                <div style={{ marginTop: 8 }}>Загрузить</div>
              </div>
            ) : null}
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  );
}
