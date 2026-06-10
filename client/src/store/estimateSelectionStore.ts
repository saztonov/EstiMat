import { create } from 'zustand';

// Контекст вида работ (категория + вид), который несёт строка/блок сметы.
export interface CostTypeCtx {
  costTypeId: string | null;
  costTypeName: string | null;
  costCategoryId: string | null;
  costCategoryName: string | null;
}

// Транзиентное выделение в окне ввода сметы. Нужно для двух сценариев:
//  - двойной клик по материалу в справочнике → к выделенной работе (selectedWorkId);
//  - двойной клик по наименованию в справочнике → в активный вид работ (activeCostTypeId).
// Активный вид/категория задаются кликом в смете (по строке работы, заголовку
// вида работ или заголовку категории). Не персистится — живёт только в сессии.
interface EstimateSelectionState {
  selectedWorkId: string | null;
  selectedWorkLabel: string | null;
  // Активная цель для наименований из справочника
  activeCostTypeId: string | null;
  activeCostTypeName: string | null;
  activeCostCategoryId: string | null;
  activeCostCategoryName: string | null;

  // Клик по строке работы: и работа (для материалов), и её вид (для наименований).
  selectWork: (id: string, label: string, ctx?: CostTypeCtx) => void;
  // Клик по заголовку вида работ: активный вид, конкретная работа сбрасывается.
  selectCostType: (ctx: CostTypeCtx) => void;
  // Клик по заголовку категории: активная категория, вид и работа сбрасываются.
  selectCategory: (id: string, name: string) => void;
  clearWork: () => void;
}

export const useEstimateSelectionStore = create<EstimateSelectionState>((set) => ({
  selectedWorkId: null,
  selectedWorkLabel: null,
  activeCostTypeId: null,
  activeCostTypeName: null,
  activeCostCategoryId: null,
  activeCostCategoryName: null,

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
}));
