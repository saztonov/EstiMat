import { useEffect, useMemo, useState } from 'react';
import type { Key } from 'react';
import { Modal, Tree, Button, Checkbox } from 'antd';
import type { DataNode } from 'antd/es/tree';
import type { CostTypeGroup } from './types';

// Модалка ревью несогласованных позиций сметы: дерево Категория → Вид работ → Работа.
// Несогласованная работа — один лист (её материалы согласуются/удаляются вместе с ней);
// под уже согласованными работами отдельными листьями показываем несогласованные материалы.
// Действия: согласовать выделенное / удалить выделенное.

const NO_CAT = '__nocat__';
const NO_TYPE = '__notype__';

interface Props {
  open: boolean;
  groups: CostTypeGroup[];
  confirming: boolean;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: (workIds: string[], materialIds: string[]) => void;
  onDelete: (workIds: string[], materialIds: string[]) => void;
}

// Построение дерева. Ключи листьев: `w:<workId>` (несогласованная работа),
// `m:<materialId>` (несогласованный материал под согласованной работой).
function buildTree(groups: CostTypeGroup[]): { nodes: DataNode[]; leafKeys: Key[] } {
  type Bucket = { name: string; works: DataNode[] };
  type Cat = { id: string; name: string; order: string[]; types: Map<string, Bucket> };
  const catMap = new Map<string, Cat>();
  const catOrder: string[] = [];
  const leafKeys: Key[] = [];

  for (const g of groups) {
    const workNodes: DataNode[] = [];
    for (const w of g.works) {
      if (w.needs_review) {
        const key = `w:${w.id}`;
        leafKeys.push(key);
        workNodes.push({ key, title: w.description, isLeaf: true });
      } else {
        const mats = w.materials.filter((m) => m.needs_review);
        if (!mats.length) continue;
        const children = mats.map<DataNode>((m) => {
          const key = `m:${m.id}`;
          leafKeys.push(key);
          return { key, title: m.description, isLeaf: true };
        });
        workNodes.push({ key: `g:${w.id}`, title: w.description, selectable: false, children });
      }
    }
    if (!workNodes.length) continue;

    const catId = g.costCategoryId ?? NO_CAT;
    let cat = catMap.get(catId);
    if (!cat) {
      cat = { id: catId, name: g.costCategoryName ?? 'Без категории', order: [], types: new Map() };
      catMap.set(catId, cat);
      catOrder.push(catId);
    }
    const typeId = g.costTypeId ?? NO_TYPE;
    let bucket = cat.types.get(typeId);
    if (!bucket) {
      bucket = { name: g.costTypeName ?? 'Без вида работ', works: [] };
      cat.types.set(typeId, bucket);
      cat.order.push(typeId);
    }
    bucket.works.push(...workNodes);
  }

  const nodes = catOrder.map<DataNode>((catId) => {
    const cat = catMap.get(catId)!;
    return {
      key: `cat:${cat.id}`,
      title: cat.name,
      selectable: false,
      children: cat.order.map<DataNode>((typeId) => {
        const t = cat.types.get(typeId)!;
        return { key: `type:${cat.id}:${typeId}`, title: t.name, selectable: false, children: t.works };
      }),
    };
  });

  return { nodes, leafKeys };
}

function splitChecked(keys: Key[]): { workIds: string[]; materialIds: string[] } {
  const workIds: string[] = [];
  const materialIds: string[] = [];
  for (const k of keys) {
    const s = String(k);
    if (s.startsWith('w:')) workIds.push(s.slice(2));
    else if (s.startsWith('m:')) materialIds.push(s.slice(2));
  }
  return { workIds, materialIds };
}

export function ReviewUnconfirmedModal({ open, groups, confirming, deleting, onCancel, onConfirm, onDelete }: Props) {
  const { nodes, leafKeys } = useMemo(() => buildTree(groups), [groups]);
  const [checkedKeys, setCheckedKeys] = useState<Key[]>([]);

  // При открытии — отметить все листья («все отмечены»).
  useEffect(() => {
    if (open) setCheckedKeys(leafKeys);
  }, [open, leafKeys]);

  const { workIds, materialIds } = useMemo(() => splitChecked(checkedKeys), [checkedKeys]);
  const selectedCount = workIds.length + materialIds.length;
  const busy = confirming || deleting;
  const allChecked = leafKeys.length > 0 && selectedCount === leafKeys.length;
  const someChecked = selectedCount > 0 && selectedCount < leafKeys.length;

  return (
    <Modal
      open={open}
      title="Подтверждение не согласованных строк"
      onCancel={onCancel}
      destroyOnClose
      width={680}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12.5, color: 'var(--est-text-secondary)' }}>
            Выбрано: работ {workIds.length}, материалов {materialIds.length}
          </span>
          <span style={{ flex: 1 }} />
          <Button onClick={onCancel} disabled={busy}>Отмена</Button>
          <Button danger loading={deleting} disabled={selectedCount === 0 || confirming} onClick={() => onDelete(workIds, materialIds)}>
            Удалить выделенное
          </Button>
          <Button type="primary" loading={confirming} disabled={selectedCount === 0 || deleting} onClick={() => onConfirm(workIds, materialIds)}>
            Согласовать выделенное
          </Button>
        </div>
      }
    >
      {nodes.length === 0 ? (
        <div style={{ padding: 16, color: 'var(--est-text-tertiary)' }}>Нет несогласованных позиций.</div>
      ) : (
        <>
          <Checkbox
            checked={allChecked}
            indeterminate={someChecked}
            disabled={busy}
            onChange={(e) => setCheckedKeys(e.target.checked ? leafKeys : [])}
            style={{ marginBottom: 8 }}
          >
            Выбрать все
          </Checkbox>
          <Tree
            checkable
            blockNode
            selectable={false}
            defaultExpandAll
            treeData={nodes}
            checkedKeys={checkedKeys}
            onCheck={(checked) => setCheckedKeys(Array.isArray(checked) ? checked : checked.checked)}
            height={420}
          />
        </>
      )}
    </Modal>
  );
}
