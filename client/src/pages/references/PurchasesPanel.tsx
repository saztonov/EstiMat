import { useState } from 'react';
import { Table, Button, Modal, Select, Tag, Space, App } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import type { CategoryResponsibles } from '../requests/types';

interface AssignableUser { id: string; full_name: string; role: string }

/**
 * Справочник «Закупки»: закрепление категорий работ за ответственными. Ответственные за категорию
 * + админы распределяют материалы этой категории в заказы поставщику (вкладка «Материалы» раздела
 * «Заявки»). Правят admin/engineer; категория без ответственных доступна всем внутренним ролям.
 */
export function PurchasesPanel() {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'admin' || role === 'engineer';

  const [editing, setEditing] = useState<CategoryResponsibles | null>(null);
  const [userIds, setUserIds] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['procurement-responsibles'],
    queryFn: () => api.get<{ data: CategoryResponsibles[] }>('/procurement/responsibles'),
  });

  // Кандидаты грузятся только при открытом редакторе.
  const usersQ = useQuery({
    queryKey: ['procurement-assignable-users'],
    queryFn: () => api.get<{ data: AssignableUser[] }>('/procurement/assignable-users'),
    enabled: editing !== null,
  });

  const saveMutation = useMutation({
    mutationFn: (vars: { categoryId: string; userIds: string[] }) =>
      api.put(`/procurement/responsibles/${vars.categoryId}`, { userIds: vars.userIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['procurement-responsibles'] });
      setEditing(null);
      message.success('Ответственные обновлены');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const openEdit = (row: CategoryResponsibles) => {
    setEditing(row);
    setUserIds(row.responsibles.map((r) => r.id));
  };

  const columns = [
    {
      title: 'Категория работ',
      dataIndex: 'name',
      render: (v: string, row: CategoryResponsibles) => (
        <Space size={4}>
          {v}
          {!row.is_active && <Tag>архив</Tag>}
        </Space>
      ),
    },
    {
      title: 'Ответственные',
      dataIndex: 'responsibles',
      render: (list: CategoryResponsibles['responsibles']) =>
        list.length === 0 ? (
          <span style={{ color: '#bfbfbf' }}>не назначены — доступно всем</span>
        ) : (
          <Space size={4} wrap>
            {list.map((u) => (
              <Tag key={u.id} color={u.is_active ? 'blue' : 'default'}>
                {u.full_name}
                {!u.is_active ? ' (неактивен)' : ''}
              </Tag>
            ))}
          </Space>
        ),
    },
    ...(canEdit
      ? [{
          title: '',
          width: 120,
          render: (_: unknown, row: CategoryResponsibles) => (
            <Button type="link" onClick={() => openEdit(row)}>Изменить</Button>
          ),
        }]
      : []),
  ];

  return (
    <div className="table-page-wrapper">
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data?.data}
        loading={isLoading}
        scroll={{ x: 640, y: 'flex' }}
        pagination={DEFAULT_PAGINATION}
      />

      <Modal
        title={editing ? `Ответственные — ${editing.name}` : ''}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => editing && saveMutation.mutate({ categoryId: editing.id, userIds })}
        confirmLoading={saveMutation.isPending}
        okText="Сохранить"
      >
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="Выберите ответственных"
          loading={usersQ.isLoading}
          value={userIds}
          onChange={setUserIds}
          optionFilterProp="label"
          options={(usersQ.data?.data ?? []).map((u) => ({ value: u.id, label: u.full_name }))}
        />
        <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
          Если ответственные не назначены — распределять материалы этой категории в заказы могут все
          внутренние роли. После назначения — только выбранные пользователи и администраторы.
        </div>
      </Modal>
    </div>
  );
}
