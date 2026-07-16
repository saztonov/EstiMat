// Проверка размерности строк свода: дробное количество в неделимой единице.
//
// Считается на клиенте из живого свода, а НЕ хранится в результате умной группировки. Причины:
//   - в result количеств нет вовсе — замечание, вшитое туда при сборке, замёрзло бы на момент
//     прогона и противоречило бы числу в соседней колонке (результат живёт неделями, пересчёт
//     идёт минутами);
//   - правка контракта результата инвалидировала бы кеш и запустила перепрогон LLM по всем сметам
//     ради проверки, которая не требует модели вовсе;
//   - проверка построчная, поэтому у подрядчика она сама сужается до его строк.
import { checkDiscreteQuantity } from '@estimat/shared';
import type { OrderMaterialRow } from './orderRow';

export interface DimensionFinding {
  orderKey: string;
  name: string;
  unit: string;
  quantity: number;
  /** Ближайшее целое вверх. */
  suggested: number;
}

/** Строки с дробным количеством штучного материала: ключ заказа → замечание. */
export function indexDimensionIssues(rows: OrderMaterialRow[]): Map<string, DimensionFinding> {
  const out = new Map<string, DimensionFinding>();
  for (const row of rows) {
    const issue = checkDiscreteQuantity(row.unit, row.quantity);
    if (!issue) continue;
    out.set(row.orderKey, {
      orderKey: row.orderKey,
      name: row.name,
      unit: row.unit,
      quantity: issue.quantity,
      suggested: issue.suggested,
    });
  }
  return out;
}
