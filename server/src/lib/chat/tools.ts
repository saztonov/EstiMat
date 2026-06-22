/**
 * Реестр инструментов агента (ТОЛЬКО чтение/поиск) и диспетчер executeTool.
 * Запись в смету выполняется отдельно через /apply — у модели write-инструментов нет.
 */
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { ChatStep, ChatStepKind, ChatCard } from '@estimat/shared';
import type { ToolDef } from '../llm/openrouter.js';
import type { AgentContext } from './types.js';
import {
  searchCatalogWorks,
  searchCatalogMaterials,
  searchSimilarWorks,
  searchSimilarMaterials,
  normalizeCostTypeIdToScope,
} from './search.js';
import { getEstimateContext, listCostCategories, previewSection } from './context.js';
import { estimateQuantity } from './calc.js';
import { assertEstimateAccess, ChatAccessError } from './access.js';

// ---------- JSON Schema инструментов ----------

const SCOPE_ENUM = ['other_projects', 'this_project', 'all'];

export const TOOL_DEFS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_estimate_context',
      description: 'Состав текущей сметы: работы, объёмы, виды затрат, что не согласовано.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_cost_categories',
      description: 'Дерево разделов и видов затрат справочника (для выбора costTypeId).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_catalog_works',
      description: 'Поиск работ в справочнике по тексту. Возвращает кандидатов с ценой и пометкой дублей.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Что ищем (наименование работы)' },
          costTypeId: { type: 'string', description: 'UUID вида затрат для сужения (опционально)' },
          limit: { type: 'number', description: 'Сколько вернуть (1..20)' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_catalog_materials',
      description: 'Поиск материалов в справочнике по тексту.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_similar_works',
      description: 'Похожие работы в сметах других объектов (референс). По умолчанию исключает текущий объект.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          scope: { type: 'string', enum: SCOPE_ENUM },
          limit: { type: 'number' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_similar_materials',
      description: 'Похожие материалы в сметах других объектов (с указанием родительской работы и объекта).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          scope: { type: 'string', enum: SCOPE_ENUM },
          limit: { type: 'number' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'estimate_quantity',
      description: 'Калькулятор объёма: площадь/периметр/объём/длина по размерам помещения.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['area', 'perimeter', 'volume', 'linear'] },
          length: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          count: { type: 'number' },
        },
        required: ['kind'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_duplicate_section',
      description: 'Превью раздела (вида затрат) из другой доступной сметы — что можно скопировать в текущую.',
      parameters: {
        type: 'object',
        properties: {
          sourceEstimateId: { type: 'string' },
          costTypeId: { type: 'string' },
        },
        required: ['sourceEstimateId', 'costTypeId'],
        additionalProperties: false,
      },
    },
  },
];

// ---------- Zod-схемы аргументов ----------

const searchWorksArgs = z.object({
  query: z.string().min(1),
  costTypeId: z.string().uuid().nullish(),
  limit: z.number().int().min(1).max(20).optional(),
});
const searchMaterialsArgs = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
});
const similarArgs = z.object({
  query: z.string().min(1),
  scope: z.enum(['other_projects', 'this_project', 'all']).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});
const calcArgs = z.object({
  kind: z.enum(['area', 'perimeter', 'volume', 'linear']),
  length: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  count: z.number().optional(),
});
const previewSectionArgs = z.object({
  sourceEstimateId: z.string().uuid(),
  costTypeId: z.string().uuid(),
});

// ---------- Диспетчер ----------

export interface ToolOutcome {
  ok: boolean;
  /** Компактный результат для модели. */
  result: unknown;
  /** Шаг для отображения хода работы. */
  step: ChatStep;
  /** Карточки-предложения для UI. */
  cards: ChatCard[];
}

function step(kind: ChatStepKind, label: string, extra: Partial<ChatStep> = {}): ChatStep {
  return { id: randomUUID(), kind, status: 'ok', label, ...extra };
}

function errStep(kind: ChatStepKind, label: string, error: string): ChatStep {
  return { id: randomUUID(), kind, status: 'error', label, error };
}

export async function executeTool(ctx: AgentContext, name: string, rawArgs: unknown): Promise<ToolOutcome> {
  try {
    switch (name) {
      case 'get_estimate_context': {
        const data = await getEstimateContext(ctx.db, ctx.estimateId);
        return {
          ok: true,
          result: data,
          step: step('estimate_context', `Контекст сметы: ${data.totalItems} поз.`, { resultCount: data.totalItems }),
          cards: [],
        };
      }
      case 'list_cost_categories': {
        const data = await listCostCategories(ctx.db);
        return { ok: true, result: data, step: step('list_categories', 'Разделы и виды затрат'), cards: [] };
      }
      case 'search_catalog_works': {
        const a = searchWorksArgs.parse(rawArgs);
        // costTypeId от LLM действует только внутри активной области подбора.
        const norm = normalizeCostTypeIdToScope(ctx.sectionScope, a.costTypeId ?? null);
        const items = await searchCatalogWorks(ctx, { query: a.query, costTypeId: norm.costTypeId, limit: a.limit });
        const result = items.map((c) => ({
          source: c.source, catalogId: c.catalogId, name: c.name, unit: c.unit, price: c.price,
          costTypeName: c.costTypeName, duplicate: c.duplicateOfItemId != null,
        }));
        const label = norm.ignored
          ? `Поиск работ: «${a.query}» — ${items.length} (costTypeId вне выбранной области — игнорирован)`
          : `Поиск работ: «${a.query}» — ${items.length}`;
        return {
          ok: true,
          result,
          step: step('search_works', label, { query: a.query, resultCount: items.length }),
          cards: items.length ? [{ type: 'work_candidates', title: a.query, items }] : [],
        };
      }
      case 'search_catalog_materials': {
        const a = searchMaterialsArgs.parse(rawArgs);
        const items = await searchCatalogMaterials(ctx, { query: a.query, limit: a.limit });
        const result = items.map((c) => ({
          source: c.source, catalogId: c.catalogId, name: c.name, unit: c.unit, price: c.price,
          duplicate: c.duplicateOfItemId != null,
        }));
        return {
          ok: true,
          result,
          step: step('search_materials', `Поиск материалов: «${a.query}» — ${items.length}`, { query: a.query, resultCount: items.length }),
          cards: items.length ? [{ type: 'material_candidates', title: a.query, items }] : [],
        };
      }
      case 'search_similar_works': {
        const a = similarArgs.parse(rawArgs);
        const items = await searchSimilarWorks(ctx, a);
        const result = items.map((s) => ({
          description: s.description, quantity: s.quantity, unit: s.unit, unitPrice: s.unitPrice,
          project: s.projectName, hasRate: s.rateId != null,
        }));
        return {
          ok: true,
          result,
          step: step('similar_works', `Похожие работы: «${a.query}» — ${items.length}`, { query: a.query, resultCount: items.length }),
          cards: items.length ? [{ type: 'similar_works', items }] : [],
        };
      }
      case 'search_similar_materials': {
        const a = similarArgs.parse(rawArgs);
        const items = await searchSimilarMaterials(ctx, a);
        const result = items.map((s) => ({
          description: s.description, quantity: s.quantity, unit: s.unit, unitPrice: s.unitPrice,
          project: s.projectName, parentWork: s.parentWorkDescription,
        }));
        return {
          ok: true,
          result,
          step: step('similar_materials', `Похожие материалы: «${a.query}» — ${items.length}`, { query: a.query, resultCount: items.length }),
          cards: items.length ? [{ type: 'similar_materials', items }] : [],
        };
      }
      case 'estimate_quantity': {
        const a = calcArgs.parse(rawArgs);
        const r = estimateQuantity(a);
        return {
          ok: true,
          result: r,
          step: step('estimate_quantity', `Расчёт: ${r.formula}`),
          cards: [{ type: 'calc', label: a.kind, value: r.value, unit: r.unit, formula: r.formula }],
        };
      }
      case 'preview_duplicate_section': {
        const a = previewSectionArgs.parse(rawArgs);
        await assertEstimateAccess(ctx.db, a.sourceEstimateId, ctx.user); // доступ к источнику
        const works = await previewSection(ctx.db, a.sourceEstimateId, a.costTypeId);
        const cardWorks = works.map((w) => ({
          description: w.description, quantity: w.quantity, unit: w.unit, unitPrice: w.unitPrice,
          rateId: null, projectCode: null, projectName: null, estimateId: w.estimateId, similarity: 1,
        }));
        return {
          ok: true,
          result: { count: works.length },
          step: step('section_preview', `Превью раздела — ${works.length} работ`, { resultCount: works.length }),
          cards: [{ type: 'section_preview', sourceEstimateId: a.sourceEstimateId, costTypeId: a.costTypeId, works: cardWorks }],
        };
      }
      default:
        return { ok: false, result: { error: `Неизвестный инструмент: ${name}` }, step: errStep('search_works', name, 'неизвестный инструмент'), cards: [] };
    }
  } catch (err) {
    const msg =
      err instanceof ChatAccessError
        ? err.message
        : err instanceof z.ZodError
          ? 'некорректные аргументы инструмента'
          : err instanceof Error
            ? err.message
            : 'ошибка инструмента';
    return { ok: false, result: { ok: false, error: msg }, step: errStep('search_works', name, msg), cards: [] };
  }
}
