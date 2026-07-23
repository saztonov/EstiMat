/**
 * Разбор отказа «материалы заявки в активной закупке» (409 при удалении заявки).
 *
 * Вынесено из вкладки по образцу overplaced.ts: модуль без antd/React тестируем напрямую, а
 * контракт code+data уже ломался в истории проекта (см. комментарий у overplacedPayloadSchema).
 */
import { requestInPurchasePayloadSchema, REQUEST_IN_PURCHASE_CODE, type BlockingOrder } from '@estimat/shared';
import { ApiError } from '../../services/apiError';

/**
 * Достать список блокирующих заказов. Возвращает null для любой другой ошибки — вызывающий код
 * тогда показывает обычное сообщение. Разбор общей схемой, не приведением типа.
 */
export function parseRequestInPurchase(e: unknown): BlockingOrder[] | null {
  if (!(e instanceof ApiError)) return null;
  // Код отличает этот 409 от других конфликтов (OCC и т.п.).
  if (e.status !== 409 || e.code !== REQUEST_IN_PURCHASE_CODE) return null;
  const parsed = requestInPurchasePayloadSchema.safeParse(e.data);
  return parsed.success ? parsed.data.orders : null;
}
