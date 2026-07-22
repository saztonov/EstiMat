/**
 * Что показывает шапка заказа и какое действие в окне главное — без UI.
 *
 * Отделено от разметки, потому что это правила, а не вёрстка: какие счета считаются действующими,
 * в какое окно укладываются поставки и что пользователь должен нажать на текущей стадии. Правила
 * покрыты тестами, разметка — нет.
 */
import type { SupplierOrderDetail, OrderInvoice } from '../types';

/** Человекочитаемый номер заказа «З-NNN». Совпадает с номером в реестре (серверный SQL). */
export function orderNumberOf(orderNo: number | null | undefined): string {
  return `З-${String(orderNo ?? 0).padStart(3, '0')}`;
}

/** Окно поставок: от первой даты до последней. null — график не задан. */
export interface DeliveryWindow {
  from: string;
  to: string;
  /** Сколько всего дат в графике (не длина периода). */
  dates: number;
}

export function deliveryWindowOf(order: SupplierOrderDetail): DeliveryWindow | null {
  const dates = [...new Set((order.deliverySchedule ?? []).map((e) => e.delivery_date))].sort();
  if (!dates.length) return null;
  return { from: dates[0]!, to: dates[dates.length - 1]!, dates: dates.length };
}

/** Счёт для шапки: подпись и признак действующего. */
export interface HeaderInvoice {
  id: string;
  /** «Счёт № 123 от 01.07.2026» либо имя файла, если реквизиты ещё не заполнены. */
  label: string;
  fileName: string | null;
  /** Замещённые счета остаются историей и показываются приглушённо. */
  superseded: boolean;
}

const fmtDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}.${m}.${y}` : null;
};

export function invoiceLabel(i: Pick<OrderInvoice, 'invoice_no' | 'invoice_date' | 'file_name'>): string {
  const date = fmtDate(i.invoice_date);
  if (i.invoice_no && date) return `Счёт № ${i.invoice_no} от ${date}`;
  if (i.invoice_no) return `Счёт № ${i.invoice_no}`;
  // Реквизиты ещё не заполнены (или не распознаны) — показываем то, что точно есть.
  return i.file_name ?? 'Счёт без номера';
}

/** Счета заказа для шапки: действующие первыми, затем замещённые. */
export function invoicesOf(order: SupplierOrderDetail): HeaderInvoice[] {
  return (order.invoices ?? [])
    .map((i) => ({
      id: i.id,
      label: invoiceLabel(i),
      fileName: i.file_name,
      superseded: i.superseded_at != null,
    }))
    .sort((a, b) => Number(a.superseded) - Number(b.superseded));
}

export type PrimaryActionKey = 'create' | 'freeze' | 'submit' | 'approve' | 'none';

export interface PrimaryAction {
  key: PrimaryActionKey;
  label: string;
}

/**
 * Главное действие окна на текущей стадии. Заменяет собой шаги мастера: пользователю нужно знать
 * не «на каком он шаге», а что он может сделать прямо сейчас.
 *
 * @param canApprove роль подтверждает поставщика (admin/manager)
 */
export function primaryActionOf(
  order: SupplierOrderDetail | null,
  canApprove: boolean,
): PrimaryAction {
  if (!order) return { key: 'create', label: 'Создать заказ' };
  // Тендер ведёт площадка: ручного действия в этом окне нет.
  if (order.procurement_method === 'tender') return { key: 'none', label: '' };

  switch (order.sourcing_status) {
    case 'forming':
      return { key: 'freeze', label: 'Зафиксировать состав' };
    case 'sourcing':
      return { key: 'submit', label: 'Отправить на согласование' };
    case 'approval':
      // Отправивший предложение инженер ждёт решения — кнопки у него нет.
      return canApprove ? { key: 'approve', label: 'Подтвердить' } : { key: 'none', label: '' };
    default:
      return { key: 'none', label: '' };
  }
}

/** Можно ли ещё править состав и график: после фиксации они заморожены. */
export function isCompositionEditable(order: SupplierOrderDetail | null): boolean {
  return order?.sourcing_status === 'forming';
}
