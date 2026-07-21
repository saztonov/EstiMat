import { useState } from 'react';
import { App, Button, Empty, Input, Popconfirm, Space, Spin } from 'antd';
import { EditOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';

interface Cipher {
  id: string;
  code: string;
}

interface Props {
  projectId: string;
}

// Управление шифрами рабочей документации объекта: список + добавление/переименование/удаление.
// Порядок — алфавитный по code (сервер сортирует), отдельного управления порядком нет.
export function CiphersModal({ projectId }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [newCode, setNewCode] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState('');

  const queryKey = ['project-ciphers', projectId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => api.get<{ data: Cipher[] }>(`/projects/${projectId}/ciphers`),
  });
  const ciphers = data?.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  const onErr = (e: Error) => message.error(e.message);

  const createM = useMutation({
    mutationFn: (code: string) => api.post(`/projects/${projectId}/ciphers`, { code }),
    onSuccess: () => { invalidate(); setNewCode(''); message.success('Шифр добавлен'); },
    onError: onErr,
  });
  const updateM = useMutation({
    mutationFn: ({ id, code }: { id: string; code: string }) =>
      api.put(`/projects/${projectId}/ciphers/${id}`, { code }),
    onSuccess: () => { invalidate(); setEditingId(null); },
    onError: onErr,
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${projectId}/ciphers/${id}`),
    onSuccess: () => invalidate(),
    onError: onErr,
  });

  const submitNew = () => { const c = newCode.trim(); if (c) createM.mutate(c); };
  const submitEdit = () => {
    const c = editingCode.trim();
    if (c && editingId) updateM.mutate({ id: editingId, code: c });
  };

  return (
    <div>
      <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
        <Input
          placeholder="Новый шифр, напр. 133_23-ГК-ЭО1"
          value={newCode}
          maxLength={100}
          onChange={(e) => setNewCode(e.target.value)}
          onPressEnter={submitNew}
        />
        <Button type="primary" icon={<PlusOutlined />} loading={createM.isPending} disabled={!newCode.trim()} onClick={submitNew}>
          Добавить
        </Button>
      </Space.Compact>

      <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid var(--est-border)', borderRadius: 8, padding: 4 }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 16 }}><Spin /></div>
        ) : ciphers.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет шифров" />
        ) : (
          ciphers.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px' }}>
              {editingId === c.id ? (
                <Space.Compact style={{ flex: 1 }}>
                  <Input
                    size="small"
                    autoFocus
                    value={editingCode}
                    maxLength={100}
                    onChange={(e) => setEditingCode(e.target.value)}
                    onPressEnter={submitEdit}
                  />
                  <Button size="small" type="primary" icon={<CheckOutlined />} loading={updateM.isPending} onClick={submitEdit} />
                  <Button size="small" icon={<CloseOutlined />} onClick={() => setEditingId(null)} />
                </Space.Compact>
              ) : (
                <>
                  <span style={{ flex: 1, minWidth: 0 }}>{c.code}</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    title="Переименовать"
                    onClick={() => { setEditingId(c.id); setEditingCode(c.code); }}
                  />
                  <Popconfirm title="Удалить шифр?" okText="Да" cancelText="Нет" onConfirm={() => deleteM.mutate(c.id)}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
