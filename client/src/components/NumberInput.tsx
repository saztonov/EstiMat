import { InputNumber } from 'antd';
import type { InputNumberProps } from 'antd';
import { formatRu, parseRu } from '../lib/number';

/**
 * Числовое поле в единой русской локали: разделитель тысяч (неразрывный пробел), десятичная
 * запятая, без стрелок-спиннеров, без изменения значения колесом мыши. Наружу (в форму/onChange)
 * отдаёт обычное number — разделители живут только в отображении.
 *
 * Пресеты задают точность и разумные границы. `max` ставится ТОЛЬКО на поля ручного ввода
 * отдельных значений (не на вычисляемые итоги): предел суммы — единицы миллиардов, чтобы
 * поймать случайный лишний ноль; агрегаты форматируются отдельно (formatMoney) и не ограничены.
 */
export type NumberPreset = 'money' | 'quantity' | 'integer';

const PRESETS: Record<NumberPreset, { precision?: number; min?: number; max?: number }> = {
  // Деньги: 2 знака, до ~10 млрд на одно поле ручного ввода.
  money: { precision: 2, min: 0, max: 9_999_999_999.99 },
  // Количество: до 4 знаков, неотрицательное; общий верхний предел не навязываем.
  quantity: { precision: 4, min: 0 },
  // Целое: диапазон задаёт вызывающее поле.
  integer: { precision: 0 },
};

export interface NumberInputProps extends Omit<InputNumberProps<number>, 'controls' | 'formatter' | 'parser'> {
  preset?: NumberPreset;
}

export function NumberInput({ preset = 'money', min, max, precision, ...rest }: NumberInputProps) {
  const p = PRESETS[preset];
  return (
    <InputNumber<number>
      controls={false}
      changeOnWheel={false}
      formatter={(value) => formatRu(value as string | number | undefined)}
      parser={(display) => parseRu(display) as unknown as number}
      precision={precision ?? p.precision}
      min={min ?? p.min}
      max={max ?? p.max}
      {...rest}
    />
  );
}
