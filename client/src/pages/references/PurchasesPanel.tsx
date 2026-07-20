import { useMemo, useState } from 'react';
import { Table, Button, Tag, Space, App, Popconfirm, Tooltip, Alert } from 'antd';
import { TeamOutlined, ClearOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PROCUREMENT_ASSIGN_ROLES } from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { ResponsibleCell } from './ResponsibleCell';
import { ResponsiblesModal } from './ResponsiblesModal';
import type { AssignableUser, CategoryResponsibles, CostTypeResponsibleNode } from '../requests/types';

/**
 * Справочник «Закупки»: ответственные за категории и виды затрат.
 *
 * Модель — один ответственный на область с наследованием вид → категория. Назначение на категорию
 * применяется ко всем её видам (индивидуальные назначения при этом снимаются — с подтверждением,
 * чтобы потеря не была молчаливой). Правят manager/admin.
 *
 * Дерево строится через tree data (`children`), а не вложенной таблицей: колонки остаются общими,
 * раскрытие «+» antd рисует сам.
 */

type Row =
  | ({ kind: 'cat' } & CategoryResponsibles)
  | ({ kind: 'type'; categoryId: string; inheritedName: string | null } & CostTypeResponsibleNode);

export function PurchasesPanel() {
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = PROCUREMENT_ASSIGN_ROLES.includes(role as never);
  const [peopleOpen, setPeopleOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['procurement-responsibles'],
    queryFn: () => api.get<{ data: CategoryResponsibles[] }>('/procurement/responsibles'),
  });

  const usersQ = useQuery({
    queryKey: ['procurement-assignable-users'],
    queryFn: () => api.get<{ data: AssignableUser[] }>('/procurement/assignable-users'),
  });
  const assignable = usersQ.data?.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['procurement-responsibles'] });
    // Свод материалов показывает унаследованного ответственного — он тоже устарел.
    queryClient.invalidateQueries({ queryKey: ['su10-materials'] });
  };

  const setCategory = useMutation({
    mutationFn: (v: { categoryId: string; userId: string | null; clearTypeOverrides: boolean }) =>
      api.put(`/procurement/responsibles/category/${v.categoryId}`, {
        userId: v.userId, clearTypeOverrides: v.clearTypeOverrides,
      }),
    onSuccess: () => { invalidate(); message.success('Ответственный за категорию обновлён'); },
    onError: (e: Error) => message.error(e.message),
  });

  const setCostType = useMutation({
    mutationFn: (v: { costTypeId: string; userId: string | null }) =>
      api.put(`/procurement/responsibles/cost-type/${v.costTypeId}`, { userId: v.userId }),
    onSuccess: () => { invalidate(); message.success('Ответственный за вид затрат обновлён'); },
    onError: (e: Error) => message.error(e.message),
  });

  /**
   * Назначение на категорию перезаписывает индивидуальные назначения видов — так требует правило
   * «назначили на категорию, применилось ко всем видам». Спрашиваем подтверждение, только если
   * терять действительно есть что.
   */
  function assignCategory(cat: CategoryResponsibles, userId: string | null) {
    const overrides = cat.types.filter((t) => t.responsible_id).length;
    if (overrides === 0) {
      setCategory.mutate({ categoryId: cat.id, userId, clearTypeOverrides: true });
      return;
    }
    modal.confirm({
      title: userId ? 'Применить ко всем видам затрат?' : 'Очистить категорию и все виды?',
      content: `Индивидуальные назначения будут сняты: ${overrides} ${overrides === 1 ? 'вид' : 'вида(ов)'} затрат вернутся к ответственному категории.`,
      okText: userId ? 'Применить' : 'Очистить',
      cancelText: 'Отмена',
      onOk: () => setCategory.mutateAsync({ categoryId: cat.id, userId, clearTypeOverrides: true }),
    });
  }

  const rows = useMemo<Row[]>(() => (data?.data ?? []).map((cat) => ({
    ...cat,
    kind: 'cat' as const,
    children: cat.types.map((t) => ({
      ...t,
      kind: 'type' as const,
      categoryId: cat.id,
      // Что вид унаследует, если снять с него собственное назначение.
      inheritedName: cat.responsible_name,
    })),
  })) as Row[], [data]);

  const columns = [
    {
      title: 'Категория / вид затрат',
      key: 'name',
      render: (_: unknown, r: Row) => (
        <Space size={4}>
          <span style={{ fontWeight: r.kind === 'cat' ? 500 : 400 }}>{r.name}</span>
          {!r.is_active && <Tag>архив</Tag>}
        </Space>
      ),
    },
    {
      title: 'Ответственный',
      key: 'resp',
      width: 320,
      render: (_: unknown, r: Row) => {
        if (r.kind === 'cat') {
          return (
            <ResponsibleCell
              value={r.responsible_id}
              substitute={r.substitution_id && r.substitute_name && r.substitution_ends_on
                ? { name: r.substitute_name, endsOn: r.substitution_ends_on } : null}
              assignable={assignable}
              disabled={!canEdit}
              loading={setCategory.isPending && setCategory.variables?.categoryId === r.id}
              onChange={(userId) => assignCategory(r, userId)}
            />
          );
        }
        return (
          <ResponsibleCell
            value={r.responsible_id}
            inheritedName={r.inheritedName}
            assignable={assignable}
            disabled={!canEdit}
            loading={setCostType.isPending && setCostType.variables?.costTypeId === r.id}
            onChange={(userId) => setCostType.mutate({ costTypeId: r.id, userId })}
          />
        );
      },
    },
    ...(canEdit ? [{
      title: '',
      key: 'act',
      width: 60,
      align: 'right' as const,
      render: (_: unknown, r: Row) => {
        if (r.kind === 'cat') {
          if (!r.responsible_id && r.types.every((t) => !t.responsible_id)) return null;
          return (
            <Tooltip title="Очистить категорию и все виды">
              <Popconfirm
                title="Очистить назначения?"
                description="Категория и все её виды затрат останутся без ответственного."
                okText="Очистить" cancelText="Отмена"
                onConfirm={() => setCategory.mutate({ categoryId: r.id, userId: null, clearTypeOverrides: true })}
              >
                <Button type="text" size="small" icon={<ClearOutlined />} />
              </Popconfirm>
            </Tooltip>
          );
        }
        if (!r.responsible_id) return null;
        return (
          <Tooltip title="Вернуть наследование от категории">
            <Button type="text" size="small" icon={<ClearOutlined />}
              onClick={() => setCostType.mutate({ costTypeId: r.id, userId: null })} />
          </Tooltip>
        );
      },
    }] : []),
  ];

  return (
    <div className="table-page-wrapper">
      <Space style={{ marginBottom: 12 }} wrap>
        <Button icon={<TeamOutlined />} onClick={() => setPeopleOpen(true)}>Ответственные</Button>
        {!canEdit && <Tag color="default">Изменения доступны руководителю</Tag>}
      </Space>

      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="Вид затрат без своего ответственного наследует ответственного категории. Назначение на категорию применяется ко всем её видам."
      />

      <Table<Row>
        rowKey={(r) => (r.kind === 'cat' ? `cat:${r.id}` : `type:${r.id}`)}
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        size="small"
        scroll={{ x: 720, y: 'flex' }}
        pagination={DEFAULT_PAGINATION}
      />

      {peopleOpen && (
        <ResponsiblesModal
          assignable={assignable}
          canEdit={canEdit}
          onClose={() => setPeopleOpen(false)}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}
