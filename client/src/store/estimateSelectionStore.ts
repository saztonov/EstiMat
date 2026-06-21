import { create } from 'zustand';

// Контекст вида работ (категория + вид), который несёт строка/блок сметы.
export interface CostTypeCtx {
  costTypeId: string | null;
  costTypeName: string | null;
  costCategoryId: string | null;
  costCategoryName: string | null;
}

// Запрос «показать в дереве справочника работ»: ключи узлов для раскрытия
// (формат treeMappers: cat:<id>, type:<id>) и целевой узел для прокрутки.
export interface RatesTreeReveal {
  keys: string[];
  targetKey: string;
  nonce: number;
}

// Запрос «прокрутить к работе в смете» (например, из ИИ-чата после добавления).
export interface EstimateItemReveal {
  itemId: string;
  nonce: number;
}

// Транзиентное выделение в окне ввода сметы. Нужно для двух сценариев:
//  - двойной клик по материалу в справочнике → к выделенной работе (selectedWorkId);
//  - двойной клик по виду/категории в смете → раскрыть это место в дереве справочника.
// Активный вид/категория (клик в смете) — визуальная подсветка текущего контекста.
// Не персистится — живёт только в сессии.
interface EstimateSelectionState {
  selectedWorkId: string | null;
  selectedWorkLabel: string | null;
  // Активный контекст в смете (подсветка вида работ/категории)
  activeCostTypeId: string | null;
  activeCostTypeName: string | null;
  activeCostCategoryId: string | null;
  activeCostCategoryName: string | null;
  // Запрос раскрытия дерева справочника работ (двойной клик по виду/категории в смете)
  revealRequest: RatesTreeReveal | null;
  // Запрос прокрутки к работе в смете (из ИИ-чата)
  estimateRevealRequest: EstimateItemReveal | null;

  // Клик по строке работы: и работа (для материалов), и её вид (для подсветки).
  selectWork: (id: string, label: string, ctx?: CostTypeCtx) => void;
  // Клик по заголовку вида работ: активный вид, конкретная работа сбрасывается.
  selectCostType: (ctx: CostTypeCtx) => void;
  // Клик по заголовку категории: активная категория, вид и работа сбрасываются.
  selectCategory: (id: string, name: string) => void;
  clearWork: () => void;
  // Двойной клик по виду/категории в смете — раскрыть их в дереве справочника.
  revealInRatesTree: (categoryId: string | null, costTypeId?: string | null) => void;
  // Прокрутить/подсветить работу в смете (по id) — из ИИ-чата.
  revealEstimateItem: (itemId: string) => void;
}

export const useEstimateSelectionStore = create<EstimateSelectionState>((set) => ({
  selectedWorkId: null,
  selectedWorkLabel: null,
  activeCostTypeId: null,
  activeCostTypeName: null,
  activeCostCategoryId: null,
  activeCostCategoryName: null,
  revealRequest: null,
  estimateRevealRequest: null,

  selectWork: (id, label, ctx) =>
    set(
      ctx
        ? {
            selectedWorkId: id,
            selectedWorkLabel: label,
            activeCostTypeId: ctx.costTypeId,
            activeCostTypeName: ctx.costTypeName,
            activeCostCategoryId: ctx.costCategoryId,
            activeCostCategoryName: ctx.costCategoryName,
          }
        : { selectedWorkId: id, selectedWorkLabel: label },
    ),

  selectCostType: (ctx) =>
    set({
      selectedWorkId: null,
      selectedWorkLabel: null,
      activeCostTypeId: ctx.costTypeId,
      activeCostTypeName: ctx.costTypeName,
      activeCostCategoryId: ctx.costCategoryId,
      activeCostCategoryName: ctx.costCategoryName,
    }),

  selectCategory: (id, name) =>
    set({
      selectedWorkId: null,
      selectedWorkLabel: null,
      activeCostTypeId: null,
      activeCostTypeName: null,
      activeCostCategoryId: id,
      activeCostCategoryName: name,
    }),

  clearWork: () => set({ selectedWorkId: null, selectedWorkLabel: null }),

  revealInRatesTree: (categoryId, costTypeId) =>
    set((s) => {
      const keys: string[] = [];
      if (categoryId) keys.push(`cat:${categoryId}`);
      if (costTypeId) keys.push(`type:${costTypeId}`);
      const targetKey = keys[keys.length - 1];
      if (!targetKey) return {};
      return {
        revealRequest: {
          keys,
          targetKey,
          nonce: (s.revealRequest?.nonce ?? 0) + 1,
        },
      };
    }),

  revealEstimateItem: (itemId) =>
    set((s) => ({
      estimateRevealRequest: { itemId, nonce: (s.estimateRevealRequest?.nonce ?? 0) + 1 },
    })),
}));
