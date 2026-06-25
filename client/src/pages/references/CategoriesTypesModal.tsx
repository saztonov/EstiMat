import { useEffect, useState } from 'react';
import { Modal, Row, Col, Button, Input, Space, Empty, App } from 'antd';
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';

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
    queryClient.invalidateQueries({ queryKey: ['rates-tree'] });
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
    onSuccess: () => invalidate(),
    onError: onErr,
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
  const reorderTypes = useMutation({
    mutationFn: ({ categoryId, ids }: { categoryId: string; ids: string[] }) =>
      api.patch('/rates/types/reorder', { categoryId, ids }),
    onSuccess: () => invalidate(),
    onError: onErr,
  });

  // Перестановка соседей: меняем местами и шлём полный список id в новом порядке.
  function moveCategory(pos: number, dir: -1 | 1) {
    const arr = categories.slice();
    const j = pos + dir;
    if (pos < 0 || j < 0 || j >= arr.length) return;
    const [moved] = arr.splice(pos, 1);
    if (!moved) return;
    arr.splice(j, 0, moved);
    reorderCategories.mutate(arr.map((c) => c.id));
  }
  function moveType(pos: number, dir: -1 | 1) {
    if (!selectedCategoryId) return;
    const arr = types.slice();
    const j = pos + dir;
    if (pos < 0 || j < 0 || j >= arr.length) return;
    const [moved] = arr.splice(pos, 1);
    if (!moved) return;
    arr.splice(j, 0, moved);
    reorderTypes.mutate({ categoryId: selectedCategoryId, ids: arr.map((t) => t.id) });
  }

  function commitRename() {
    if (!editing) return;
    const name = editing.value.trim();
    if (!name) return message.warning('Название не может быть пустым');
    if (editing.kind === 'cat') renameCategory.mutate({ id: editing.id, name });
    else renameType.mutate({ id: editing.id, name });
  }

  // Строка списка: ↑ ↓ название [✎] либо инлайн-редактор названия.
  function renderRow(
    kind: 'cat' | 'type',
    row: { id: string; name: string },
    pos: number,
    count: number,
    onMove: (pos: number, dir: -1 | 1) => void,
    selected?: boolean,
    onSelect?: () => void,
  ) {
    const isEditing = editing?.kind === kind && editing.id === row.id;
    return (
      <div
        key={row.id}
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
        <Button type="text" size="small" title="Выше" icon={<ArrowUpOutlined />}
          disabled={pos <= 0} onClick={(e) => { e.stopPropagation(); onMove(pos, -1); }} />
        <Button type="text" size="small" title="Ниже" icon={<ArrowDownOutlined />}
          disabled={pos >= count - 1} onClick={(e) => { e.stopPropagation(); onMove(pos, 1); }} />
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
          </>
        )}
      </div>
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
              categories.map((c, i) =>
                renderRow('cat', c, i, categories.length, moveCategory,
                  c.id === selectedCategoryId, () => setSelectedCategoryId(c.id)),
              )
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
              types.map((t, i) => renderRow('type', t, i, types.length, moveType))
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
