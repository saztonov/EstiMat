// Плоские блоки материалов для окна графика поставки.
//
// Окну нужен один вид блока на обе группировки: стандартное дерево там разворачивать не во что —
// дата ставится на блок, и «на какой из вложенных узлов» было бы неоднозначно. Поэтому лист дерева
// = блок, а путь до него уходит в подпись.
//
// Главный инвариант — тот же, что у дерева: блоки сохраняют свод. Строка, не попавшая ни в один
// блок, не исчезает, а уходит в хвостовой блок: иначе материал молча остался бы без даты поставки,
// а заявку отклонили бы на валидации без объяснения, где искать.
import type { GroupingResult } from '@estimat/shared';
import type { OrderMaterialRow } from './orderRow';
import type { MaterialLevelSettings } from './materialTree';
import { buildMaterialTree, type MaterialTreeNode } from './materialTree';

/** Ключи секций умной группировки. Здесь, а не в панели: модуль чистый и общий. */
export const SHARED_KEY = 'smart:shared';
export const UNGROUPED_KEY = 'smart:ungrouped';

/** Хвостовой блок: всё, что группировка не охватила. */
export const REST_KEY = 'block:rest';

export interface MaterialBlock {
  /** Уникален в пределах режима: ключ листа дерева либо id группы/секции. */
  key: string;
  title: string;
  /** Пояснение в шапке: назначение ИИ-группы или подсказка секции. */
  hint?: string;
  /** Ключи заказа строк блока в порядке показа. */
  orderKeys: string[];
}

/** Собрать блок, отбросив уже разобранные ключи. Пустой блок не возвращается. */
function take(
  keys: string[],
  used: Set<string>,
  known: Set<string>,
  block: Omit<MaterialBlock, 'orderKeys'>,
): MaterialBlock | null {
  const orderKeys: string[] = [];
  for (const k of keys) {
    // Ключ забирает первый заявивший его блок: пересечение групп задвоило бы материал, а с ним и
    // количество к поставке.
    if (!known.has(k) || used.has(k)) continue;
    used.add(k);
    orderKeys.push(k);
  }
  return orderKeys.length ? { ...block, orderKeys } : null;
}

/** Строки, не попавшие ни в один блок, — отдельным блоком в конце. */
function withRest(blocks: MaterialBlock[], rows: OrderMaterialRow[], used: Set<string>, title: string, hint?: string) {
  const rest = rows.filter((r) => !used.has(r.orderKey)).map((r) => r.orderKey);
  return rest.length ? [...blocks, { key: REST_KEY, title, hint, orderKeys: rest }] : blocks;
}

/** Стандартная группировка → блоки: лист дерева = блок, подпись — путь до него. */
export function standardBlocks(rows: OrderMaterialRow[], levels: MaterialLevelSettings): MaterialBlock[] {
  const known = new Set(rows.map((r) => r.orderKey));
  const used = new Set<string>();
  const blocks: MaterialBlock[] = [];

  const walk = (nodes: MaterialTreeNode[], path: string[]) => {
    for (const n of nodes) {
      const title = [...path, labelOf(n)].filter(Boolean).join(' · ');
      if (n.materials.length > 0) {
        const block = take(
          n.materials.map((m) => m.orderKey),
          used,
          known,
          { key: n.key, title },
        );
        if (block) blocks.push(block);
      }
      walk(n.children, [...path, labelOf(n)]);
    }
  };
  walk(buildMaterialTree(rows, levels), []);

  return withRest(blocks, rows, used, 'Прочие материалы');
}

/** Умная группировка → блоки: группы плюс две секции. */
export function smartBlocks(rows: OrderMaterialRow[], result: GroupingResult | null): MaterialBlock[] {
  // Группировки нет (не сформирована, не настроен провайдер, ещё считается) — материалы всё равно
  // должны быть видны и заполнимы: окно открыто посреди создания заявки.
  if (!result) {
    return rows.length ? [{ key: REST_KEY, title: 'Материалы заявки', orderKeys: rows.map((r) => r.orderKey) }] : [];
  }

  const known = new Set(rows.map((r) => r.orderKey));
  const used = new Set<string>();
  const blocks: MaterialBlock[] = [];

  for (const g of result.groups) {
    const block = take(g.orderKeys, used, known, { key: g.id, title: g.name, hint: g.purpose ?? undefined });
    if (block) blocks.push(block);
  }
  const shared = take(result.sharedKeys, used, known, { key: SHARED_KEY, title: 'Общие расходные материалы' });
  if (shared) blocks.push(shared);
  const ungrouped = take(result.ungroupedKeys, used, known, {
    key: UNGROUPED_KEY,
    title: 'Не удалось сгруппировать',
    hint: 'ИИ не отнёс эти материалы к операции',
  });
  if (ungrouped) blocks.push(ungrouped);

  // Результат мог устареть: заявляют материалы, которых в нём ещё нет.
  return withRest(blocks, rows, used, 'Не вошли в группировку', 'Группировка не охватывает эти материалы');
}

const labelOf = (n: MaterialTreeNode) =>
  n.badges ? [...n.badges.zoneNames, n.badges.floorsLabel].filter(Boolean).join(' ') || n.label : n.label;
