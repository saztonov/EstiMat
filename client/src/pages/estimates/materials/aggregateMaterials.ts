// Свод материалов сметы: группировка по виду работ (как в смете), внутри —
// свёртка материалов по справочной позиции (material_id) или нормализованному
// названию для текстовых материалов. Источник данных — тот же EstimateDetail,
// что кэшируется под ['estimate', id]; никаких отдельных запросов.
import { aggKey } from '@estimat/shared';
import type { EstimateContractor, EstimateItem } from '../components/types';
import { buildCostTypeGroups } from '../components/types';
import { toLocationSnapshot, type LocationSnapshot } from '../components/location';

// Одно вхождение материала в конкретную работу (строка estimate_materials).
export interface MaterialOccurrence {
  materialRowId: string;
  workId: string;
  workName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
  source?: 'manual' | 'ai' | 'catalog';
  needsReview: boolean;
  status: 'suggested' | 'confirmed';
  /** Локация работы-источника: свод сворачивает материалы по виду работ, и без снимка
   *  привязка к корпусу/этажу/типу теряется (нужна для бейджей и разбивки). */
  location: LocationSnapshot;
}

// Свёрнутая строка свода: один материал в пределах вида работ.
export interface AggregatedMaterial {
  key: string;
  materialId: string | null;
  name: string;
  unit: string;
  quantity: number; // сумма по вхождениям
  total: number; // сумма по вхождениям
  unitPrice: number; // средневзвешенная: total / quantity
  hasAi: boolean;
  hasNeedsReview: boolean;
  hasSuggested: boolean;
  occurrences: MaterialOccurrence[];
}

// Блок свода = вид работ (cost_type) с назначенным подрядчиком.
export interface MaterialGroup {
  costTypeId: string | null;
  costTypeName: string | null;
  costCategoryName: string | null;
  contractorName: string | null;
  materials: AggregatedMaterial[];
  total: number;
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);

// Построить свод материалов, сгруппированный по виду работ.
export function buildMaterialGroups(
  items: EstimateItem[],
  contractors: EstimateContractor[],
): MaterialGroup[] {
  const groups = buildCostTypeGroups(items, contractors);

  return groups
    .map((g) => {
      const byKey = new Map<string, AggregatedMaterial>();

      for (const work of g.works) {
        for (const m of work.materials) {
          const name = m.material_name || m.description || 'Материал';
          const key = aggKey(m.material_id, name, m.unit);
          const occ: MaterialOccurrence = {
            materialRowId: m.id,
            workId: work.id,
            workName: work.description,
            quantity: num(m.quantity),
            unit: m.unit,
            unitPrice: num(m.unit_price),
            total: num(m.total),
            source: m.source,
            needsReview: !!m.needs_review,
            status: m.status,
            location: toLocationSnapshot(work),
          };

          let agg = byKey.get(key);
          if (!agg) {
            agg = {
              key,
              materialId: m.material_id,
              name,
              unit: m.unit,
              quantity: 0,
              total: 0,
              unitPrice: 0,
              hasAi: false,
              hasNeedsReview: false,
              hasSuggested: false,
              occurrences: [],
            };
            byKey.set(key, agg);
          }
          agg.quantity += occ.quantity;
          agg.total += occ.total;
          agg.hasAi ||= occ.source === 'ai';
          agg.hasNeedsReview ||= occ.needsReview;
          agg.hasSuggested ||= occ.status === 'suggested';
          agg.occurrences.push(occ);
        }
      }

      const materials = [...byKey.values()]
        .map((a) => ({ ...a, unitPrice: a.quantity > 0 ? a.total / a.quantity : 0 }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

      return {
        costTypeId: g.costTypeId,
        costTypeName: g.costTypeName,
        costCategoryName: g.costCategoryName,
        contractorName: g.contractor?.contractor_name ?? null,
        materials,
        total: materials.reduce((s, a) => s + a.total, 0),
      };
    })
    .filter((g) => g.materials.length > 0);
}
