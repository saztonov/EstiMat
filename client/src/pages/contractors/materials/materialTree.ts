// Дерево группировки материалов: Категория → [Вид работ] → [Локация] → [Тип работы] → материалы.
//
// Дерево — это РАЗБИЕНИЕ плоского списка строк: каждая строка попадает ровно в один лист,
// количества только суммируются вверх и никогда не пересчитываются. Отсюда требование задачи
// «переключение настроек не меняет общее количество и сумму» выполняется по построению.
import type { OrderMaterialRow } from './orderRow';

/** Какие уровни разделяют материалы. Категория — всегда верхний уровень, не настраивается. */
export interface MaterialLevelSettings {
  costType: boolean;
  location: boolean;
  locationType: boolean;
}

/**
 * Текущее поведение вкладки: материал свёрнут по всем локациям и типам внутри вида работ.
 * Дефолт обязан совпадать с ним — иначе привычный экран у всех молча изменится.
 */
export const DEFAULT_LEVELS: MaterialLevelSettings = { costType: true, location: false, locationType: false };

export type MaterialTreeLevel = 'category' | 'costType' | 'location' | 'locationType';

export interface MaterialTreeNode {
  /** Путь узла: 'cat:<id>' → 'cat:<id>/ct:<id>' → '.../loc:<sig>' → '.../lt:<sig>'. */
  key: string;
  level: MaterialTreeLevel;
  label: string;
  /** Бейджи вместо текстовой подписи (только у уровня 'location'). */
  badges: { zoneNames: string[]; floorsLabel: string } | null;
  /** Стоимость материалов по ценам закупок: строки без цены в сумму не входят. */
  total: number;
  /** Число материальных строк во всём поддереве. */
  rowCount: number;
  /** Сколько из них с известной ценой: 0 — сумму показывать нельзя (это не «0 ₽»). */
  pricedRowCount: number;
  children: MaterialTreeNode[];
  /** Непусто только у листового узла (последний включённый уровень). */
  materials: OrderMaterialRow[];
}

const NO_CATEGORY = 'Без категории';
const NO_COST_TYPE = 'Без вида работ';
const NO_LOCATION = 'Без локации';
const NO_TYPE = 'Без типа';

interface LevelSpec {
  level: MaterialTreeLevel;
  /** Ключ узла в пределах родителя. */
  keyOf: (r: OrderMaterialRow) => string;
  label: (r: OrderMaterialRow) => string;
  badges?: (r: OrderMaterialRow) => MaterialTreeNode['badges'];
  /** Узлы-корзины («Без локации») уходят в конец: у 107 работ типа нет — заметная группа. */
  isEmpty: (r: OrderMaterialRow) => boolean;
}

function specsFor(levels: MaterialLevelSettings): LevelSpec[] {
  const specs: LevelSpec[] = [
    {
      level: 'category',
      keyOf: (r) => `cat:${r.category.id ?? ''}`,
      label: (r) => r.category.name ?? NO_CATEGORY,
      isEmpty: (r) => !r.category.id && !r.category.name,
    },
  ];
  if (levels.costType) {
    specs.push({
      level: 'costType',
      keyOf: (r) => `ct:${r.costTypeId ?? ''}`,
      label: (r) => r.costTypeName ?? NO_COST_TYPE,
      isEmpty: (r) => !r.costTypeId,
    });
  }
  if (levels.location) {
    specs.push({
      level: 'location',
      keyOf: (r) => `loc:${r.locationSig}`,
      label: (r) => (r.zoneNames.length || r.floorsLabel ? '' : NO_LOCATION),
      badges: (r) => ({ zoneNames: r.zoneNames, floorsLabel: r.floorsLabel }),
      isEmpty: (r) => r.zoneNames.length === 0 && !r.floorsLabel,
    });
  }
  if (levels.locationType) {
    specs.push({
      level: 'locationType',
      keyOf: (r) => `lt:${r.typeSig}`,
      label: (r) => (r.typeLabels.length ? r.typeLabels.join(' · ') : NO_TYPE),
      isEmpty: (r) => r.typeLabels.length === 0,
    });
  }
  return specs;
}

/**
 * Собрать дерево. Порядок категорий и видов работ наследуется от входа (buildCostTypeGroups уже
 * отсортирован по sort_order) — за счёт порядка вставки в Map. Внутри новых уровней сортируем
 * сами, пустые узлы — в конец.
 */
export function buildMaterialTree(rows: OrderMaterialRow[], levels: MaterialLevelSettings): MaterialTreeNode[] {
  return buildLevel(rows, specsFor(levels), 0, '');
}

function buildLevel(
  rows: OrderMaterialRow[],
  specs: LevelSpec[],
  depth: number,
  parentKey: string,
): MaterialTreeNode[] {
  const spec = specs[depth]!;
  const buckets = new Map<string, { rows: OrderMaterialRow[]; sample: OrderMaterialRow }>();
  for (const r of rows) {
    const key = spec.keyOf(r);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { rows: [], sample: r };
      buckets.set(key, bucket);
    }
    bucket.rows.push(r);
  }

  const isLeafLevel = depth === specs.length - 1;
  const nodes = [...buckets].map(([key, bucket]) => {
    const nodeKey = parentKey ? `${parentKey}/${key}` : key;
    const node: MaterialTreeNode = {
      key: nodeKey,
      level: spec.level,
      label: spec.label(bucket.sample),
      badges: spec.badges?.(bucket.sample) ?? null,
      total: bucket.rows.reduce((s, r) => s + (r.materialCost ?? 0), 0),
      rowCount: bucket.rows.length,
      pricedRowCount: bucket.rows.filter((r) => r.materialCost != null).length,
      children: isLeafLevel ? [] : buildLevel(bucket.rows, specs, depth + 1, nodeKey),
      materials: isLeafLevel ? [...bucket.rows].sort(byName) : [],
    };
    return { node, empty: spec.isEmpty(bucket.sample) };
  });

  // Категория и вид работ уже пришли в нужном порядке; локацию и тип сортируем по подписи.
  if (spec.level === 'location' || spec.level === 'locationType') {
    nodes.sort((a, b) => labelOf(a.node).localeCompare(labelOf(b.node), 'ru'));
  }
  nodes.sort((a, b) => Number(a.empty) - Number(b.empty));
  return nodes.map((n) => n.node);
}

const byName = (a: OrderMaterialRow, b: OrderMaterialRow) => a.name.localeCompare(b.name, 'ru');

const labelOf = (n: MaterialTreeNode) =>
  n.badges ? [...n.badges.zoneNames, n.badges.floorsLabel].filter(Boolean).join(' ') || n.label : n.label;

/**
 * Оставить узлы, в поддереве которых есть хоть одна строка из keys (отбор «Не заказанные
 * материалы»).
 *
 * Отбор блочный: узел либо показан целиком, либо не показан вовсе. Счётчики и суммы узла
 * не пересчитываются — внутри показанного блока строки не прячем, и «N поз.» продолжает
 * означать состав блока, а не число уцелевших строк.
 */
export function pruneNodesByRows(nodes: MaterialTreeNode[], keys: Set<string>): MaterialTreeNode[] {
  const out: MaterialTreeNode[] = [];
  for (const n of nodes) {
    if (n.materials.some((m) => keys.has(m.orderKey))) {
      out.push(n);
      continue;
    }
    const children = pruneNodesByRows(n.children, keys);
    if (children.length) out.push({ ...n, children });
  }
  return out;
}

/** Все листовые строки дерева слева направо. */
export function flattenTreeRows(nodes: MaterialTreeNode[]): OrderMaterialRow[] {
  const out: OrderMaterialRow[] = [];
  const walk = (list: MaterialTreeNode[]) => {
    for (const n of list) {
      out.push(...n.materials);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Инвариант: дерево — разбиение входа (ничего не потеряно, не задвоено, суммы сошлись).
 * Автотестов на UI в проекте нет, поэтому дублируем проверку в dev-рантайме.
 */
export function assertTreeConserves(rows: OrderMaterialRow[], nodes: MaterialTreeNode[]): void {
  if (!import.meta.env.DEV) return;
  const leaves = flattenTreeRows(nodes);
  const keys = new Set(leaves.map((r) => r.orderKey));
  const problems: string[] = [];
  if (leaves.length !== rows.length) problems.push(`строк в дереве ${leaves.length}, во входе ${rows.length}`);
  if (keys.size !== leaves.length) problems.push(`ключи задвоены: уникальных ${keys.size} из ${leaves.length}`);
  const dq = sum(leaves, (r) => r.quantity) - sum(rows, (r) => r.quantity);
  const dt = sum(leaves, (r) => r.materialCost ?? 0) - sum(rows, (r) => r.materialCost ?? 0);
  if (Math.abs(dq) > 1e-6) problems.push(`количество разошлось на ${dq}`);
  if (Math.abs(dt) > 1e-6) problems.push(`сумма разошлась на ${dt}`);
  if (problems.length) console.error('[materialTree] дерево не сохраняет свод:', problems.join('; '));
}

const sum = (rows: OrderMaterialRow[], pick: (r: OrderMaterialRow) => number) =>
  rows.reduce((s, r) => s + pick(r), 0);
