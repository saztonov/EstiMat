/**
 * Детерминированный калькулятор объёмов работ (без LLM). Помогает сметчику
 * быстро посчитать площадь/периметр/объём/длину по геометрии помещения.
 */

export type CalcKind = 'area' | 'perimeter' | 'volume' | 'linear';

export interface CalcInput {
  kind: CalcKind;
  /** Размеры в метрах: length/width/height, либо count для linear. */
  length?: number;
  width?: number;
  height?: number;
  /** Множитель (кол-во помещений/повторов). */
  count?: number;
}

export interface CalcResult {
  value: number;
  unit: string;
  formula: string;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function estimateQuantity(input: CalcInput): CalcResult {
  const count = input.count && input.count > 0 ? input.count : 1;
  const L = input.length ?? 0;
  const W = input.width ?? 0;
  const H = input.height ?? 0;
  const mult = count > 1 ? ` × ${count}` : '';

  switch (input.kind) {
    case 'area': {
      const v = L * W * count;
      return { value: round(v), unit: 'м²', formula: `${L} × ${W}${mult} = ${round(v)} м²` };
    }
    case 'perimeter': {
      const v = 2 * (L + W) * count;
      return { value: round(v), unit: 'м', formula: `2 × (${L} + ${W})${mult} = ${round(v)} м` };
    }
    case 'volume': {
      const v = L * W * H * count;
      return { value: round(v), unit: 'м³', formula: `${L} × ${W} × ${H}${mult} = ${round(v)} м³` };
    }
    case 'linear': {
      const v = L * count;
      return { value: round(v), unit: 'м', formula: `${L}${mult} = ${round(v)} м` };
    }
    default:
      return { value: 0, unit: '', formula: 'неизвестный тип расчёта' };
  }
}
