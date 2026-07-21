/**
 * Разбор отказа «объём ниже уже заказанного» (409).
 *
 * Вынесено из модалки в отдельный модуль ради тестируемости: сама модалка тянет antd и React,
 * а проверять нужно ровно одно — что нагрузка сервера доходит до кода, который рисует
 * подтверждение. Раньше не доходила: сервер клал список в корень тела, обёртка пробрасывает
 * только `data`, а модалка читала несуществующее `body.overplaced`. Подтверждение перезаказа
 * было недостижимо целиком, и это не поймали ни типы, ни ревью.
 */
import { overplacedPayloadSchema, OVERPLACED_CODE, type OverplacedItem } from '@estimat/shared';
import { ApiError } from '../../services/apiError';

/**
 * Достать список позиций в перезаказе. Возвращает null для любой другой ошибки — вызывающий код
 * тогда показывает обычное сообщение.
 *
 * Разбираем ОБЩЕЙ схемой, а не приведением типа: `as` здесь и был причиной поломки — он
 * одинаково молча принимал и правильную форму, и пустой объект.
 */
export function parseOverplaced(e: unknown): OverplacedItem[] | null {
  if (!(e instanceof ApiError)) return null;
  // Код отличает этот 409 от конфликта версии (OCC), который обрабатывается иначе.
  if (e.status !== 409 || e.code !== OVERPLACED_CODE) return null;
  const parsed = overplacedPayloadSchema.safeParse(e.data);
  return parsed.success ? parsed.data.overplaced : null;
}
