import { useEffect, useState } from 'react';
import { Modal, Row, Col, Button, Input, Space, Empty, Popconfirm, App } from 'antd';
import {
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { DragHandle, SortableItem, SortableVerticalContext } from '../../components/dndSortable';
import { useAuthStore } from '../../store/authStore';

interface Category { id: string; name: string }
interface CostType { id: string; name: string; category_id: string }

interface Props {
  open: boolean;
  onClose: () => void;
}

type Editing = { kind: 'cat' | 'type'; id: string; value: string } | null;

// Управление порядком/именами категорий работ и видов работ внутри категории.
// Порядок применяется в дереве «Справочники» на странице сметы и в самой смете.
export function CategoriesTypesModal({ open, onClose }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore((s) => s.user?.role) === 'admin';
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Editing>(null);
  const [newCatName, setNewCatName] = useState('');
  const [newTypeName, setNewTypeName] = useState('');

  const { data: categoriesData } = useQuery({
    queryKey: ['rate-categories'],
    queryFn: () => api.get<{ data: Category[] }>('/rates/categories'),
    enabled: open,
  });
  const { data: typesData } = useQuery({
    queryKey: ['rate-types-all'],
    queryFn: () => api.get<{ data: CostType[] }>('/rates/types'),
    enabled: open,
  });

  const categories = categoriesData?.data ?? [];
  const types = (typesData?.data ?? []).filter((t) => t.category_id === selectedCategoryId);

  // По умолчанию выбрана первая категория; сбрасываем выбор, если категория исчезла.
  useEffect(() => {
    if (!open) return;
    if (categories.length === 0) { setSelectedCategoryId(undefined); return; }
    if (!selectedCategoryId || !categories.some((c) => c.id === selectedCategoryId)) {
      setSelectedCategoryId(categories[0]?.id);
    }
  }, [open, categories, selectedCategoryId]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['rate-categories'] });
    queryClient.invalidateQueries({ queryKey: ['rate-types'] });
    queryClient.invalidateQueries({ queryKey: ['rate-types-all'] });
    queryClient.invalidateQueries({ queryKey: ['rates'] });
    queryClient.invalidateQueries({ queryKey: ['rates-tree'] });
    // Порядок категорий/видов в смете берётся из sort_order справочника (живой JOIN),
    // поэтому после их пересортировки/переименования сбрасываем и кэши открытых смет.
    queryClient.invalidateQueries({ queryKey: ['estimate'] });
    queryClient.invalidateQueries({ queryKey: ['project-estimate'] });
  }

  const onErr = (err: Error) => message.error(err.message);

  const createCategory = useMutation({
    mutationFn: (name: string) => api.post('/rates/categories', { name, sortOrder: categories.length }),
    onSuccess: () => { invalidate(); setNewCatName(''); message.success('Категория добавлена'); },
    onError: onErr,
  });
  const renameCategory = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.put(`/rates/categories/${id}`, { name }),
    onSuccess: () => { invalidate(); setEditing(null); },
    onError: onErr,
  });
  const reorderCategories = useMutation({
    mutationFn: (ids: string[]) => api.patch('/rates/categories/reorder', { ids }),
    // Optimistic: переставляем категории в кэше сразу, иначе строка «прыгает» назад до refetch.
    onMutate: async (ids: string[]) => {
      const key = ['rate-categories'];
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<{ data: Category[] }>(key);
      if (prev?.data) {
        const byId = new Map(prev.data.map((c) => [c.id, c]));
        const data = ids.map((id) => byId.get(id)).filter((c): c is Category => !!c);
        queryClient.setQueryData(key, { ...prev, data });
      }
      return { prev, key };
    },
    onError: (err: Error, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev);
      onErr(err);
    },
    onSettled: () => invalidate(),
  });

  const createType = useMutation({
    mutationFn: ({ categoryId, name }: { categoryId: string; name: string }) =>
      api.post('/rates/types', { categoryId, name, sortOrder: types.length }),
    onSuccess: () => { invalidate(); setNewTypeName(''); message.success('Вид работ добавлен'); },
    onError: onErr,
  });
  const renameType = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.put(`/rates/types/${id}`, { name }),
    onSuccess: () => { invalidate(); setEditing(null); },
    onError: onErr,
  });
  // Мягкое удаление (is_active=false на сервере). Admin-only.
  const deleteCategory = useMutation({
    mutationFn: (id: string) => api.delete(`/rates/categories/${id}`),
    onSuccess: () => { invalidate(); message.success('Категория удалена'); },
    onError: onErr,
  });
  const deleteType = useMutation({
    mutationFn: (id: string) => api.delete(`/rates/types/${id}`),
    onSuccess: () => { invalidate(); message.success('Вид работ удалён'); },
    onError: onErr,
  });
  const reorderTypes = useMutation({
    mutationFn: ({ categoryId, ids }: { categoryId: string; ids: string[] }) =>
      api.patch('/rates/types/reorder', { categoryId, ids }),
    // Optimistic: переставляем виды выбранной категории внутри плоского кэша всех видов.
    onMutate: async ({ categoryId, ids }: { categoryId: string; ids: string[] }) => {
      const key = ['rate-types-all'];
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<{ data: CostType[] }>(key);
      if (prev?.data) {
        const byId = new Map(prev.data.map((t) => [t.id, t]));
        const idSet = new Set(ids);
        let k = 0;
        const data = prev.data.map((t) =>
          t.category_id === categoryId && idSet.has(t.id) ? (byId.get(ids[k++] as string) ?? t) : t,
        );
        queryClient.setQueryData(key, { ...prev, data });
      }
      return { prev, key };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev);
      onErr(err);
    },
    onSettled: () => invalidate(),
  });

  // Перетащили строку за грип: вычисляем новый порядок и шлём полный список id.
  function onCategoryDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const ids = categories.map((c) => c.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    reorderCategories.mutate(arrayMove(ids, oldIndex, newIndex));
  }
  function onTypeDragEnd({ active, over }: DragEndEvent) {
    if (!selectedCategoryId || !over || active.id === over.id) return;
    const ids = types.map((t) => t.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    reorderTypes.mutate({ categoryId: selectedCategoryId, ids: arrayMove(ids, oldIndex, newIndex) });
  }

  function commitRename() {
    if (!editing) return;
    const name = editing.value.trim();
    if (!name) return message.warning('Название не может быть пустым');
    if (editing.kind === 'cat') renameCategory.mutate({ id: editing.id, name });
    else renameType.mutate({ id: editing.id, name });
  }

  // Строка списка: ⠿ название [✎] либо инлайн-редактор названия.
  function renderRow(
    kind: 'cat' | 'type',
    row: { id: string; name: string },
    selected?: boolean,
    onSelect?: () => void,
  ) {
    const isEditing = editing?.kind === kind && editing.id === row.id;
    const pending = kind === 'cat' ? reorderCategories.isPending : reorderTypes.isPending;
    return (
      <SortableItem
        key={row.id}
        id={row.id}
        disabled={isEditing || pending}
        onClick={onSelect}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderRadius: 6,
          cursor: onSelect ? 'pointer' : 'default',
          background: selected ? '#e6f4ff' : undefined,
        }}
      >
        <DragHandle disabled={isEditing || pending} />
        {isEditing ? (
          <Space.Compact style={{ flex: 1 }} onClick={(e) => e.stopPropagation()}>
            <Input
              size="small"
              autoFocus
              value={editing!.value}
              onChange={(e) => setEditing({ ...editing!, value: e.target.value })}
              onPressEnter={commitRename}
            />
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={commitRename} />
            <Button size="small" icon={<CloseOutlined />} onClick={() => setEditing(null)} />
          </Space.Compact>
        ) : (
          <>
            <span style={{ flex: 1, minWidth: 0, fontWeight: kind === 'cat' ? 600 : 400 }}>{row.name}</span>
            <Button type="text" size="small" title="Переименовать" icon={<EditOutlined />}
              onClick={(e) => { e.stopPropagation(); setEditing({ kind, id: row.id, value: row.name }); }} />
            {isAdmin && (
              <Popconfirm
                title={kind === 'cat' ? 'Удалить категорию?' : 'Удалить вид работ?'}
                description={kind === 'cat'
                  ? 'Категория и её виды скроются из справочника.'
                  : 'Вид скроется; работы без других видов пропадут из дерева.'}
                okText="Удалить"
                okButtonProps={{ danger: true }}
                onConfirm={() => (kind === 'cat' ? deleteCategory : deleteType).mutate(row.id)}
              >
                <Button type="text" size="small" danger title="Удалить" icon={<DeleteOutlined />}
                  onClick={(e) => e.stopPropagation()} />
              </Popconfirm>
            )}
          </>
        )}
      </SortableItem>
    );
  }

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);

  return (
    <Modal
      title="Категории и виды работ"
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Закрыть</Button>}
      width={780}
    >
      <Row gutter={16}>
        <Col span={11}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Категории</div>
          <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: 4 }}>
            {categories.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет категорий" />
            ) : (
              <SortableVerticalContext
                enabled
                items={categories.map((c) => c.id)}
                onDragEnd={onCategoryDragEnd}
              >
                {categories.map((c) =>
                  renderRow('cat', c, c.id === selectedCategoryId, () => setSelectedCategoryId(c.id)),
                )}
              </SortableVerticalContext>
            )}
          </div>
          <Space.Compact style={{ width: '100%', marginTop: 8 }}>
            <Input
              size="small"
              placeholder="Новая категория"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onPressEnter={() => newCatName.trim() && createCategory.mutate(newCatName.trim())}
            />
            <Button size="small" type="primary" icon={<PlusOutlined />}
              loading={createCategory.isPending}
              disabled={!newCatName.trim()}
              onClick={() => createCategory.mutate(newCatName.trim())}>
              Добавить
            </Button>
          </Space.Compact>
        </Col>

        <Col span={13}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            Виды работ{selectedCategory ? ` — ${selectedCategory.name}` : ''}
          </div>
          <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: 4 }}>
            {!selectedCategory ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Выберите категорию слева" />
            ) : types.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет видов работ" />
            ) : (
              <SortableVerticalContext enabled items={types.map((t) => t.id)} onDragEnd={onTypeDragEnd}>
                {types.map((t) => renderRow('type', t))}
              </SortableVerticalContext>
            )}
          </div>
          <Space.Compact style={{ width: '100%', marginTop: 8 }}>
            <Input
              size="small"
              placeholder="Новый вид работ"
              value={newTypeName}
              disabled={!selectedCategoryId}
              onChange={(e) => setNewTypeName(e.target.value)}
              onPressEnter={() =>
                selectedCategoryId && newTypeName.trim() &&
                createType.mutate({ categoryId: selectedCategoryId, name: newTypeName.trim() })}
            />
            <Button size="small" type="primary" icon={<PlusOutlined />}
              loading={createType.isPending}
              disabled={!selectedCategoryId || !newTypeName.trim()}
              onClick={() => createType.mutate({ categoryId: selectedCategoryId!, name: newTypeName.trim() })}>
              Добавить
            </Button>
          </Space.Compact>
        </Col>
      </Row>
    </Modal>
  );
}
