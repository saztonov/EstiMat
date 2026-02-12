'use client'

import type { DeliveryWithRelations } from '@estimat/shared'
import { DeliveryStatusBadge } from './delivery-status-badge'

interface DeliveryRowProps {
  delivery: DeliveryWithRelations
  /** Supplier name resolved from the purchase order relation */
  supplierName?: string
  onClick?: (delivery: DeliveryWithRelations) => void
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014'
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function DeliveryRow({ delivery, supplierName, onClick }: DeliveryRowProps) {
  const displayDate = delivery.actual_date ?? delivery.expected_date

  return (
    <tr
      className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer transition-colors"
      onClick={() => onClick?.(delivery)}
    >
      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
        {delivery.id.slice(0, 8).toUpperCase()}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
        {delivery.order?.id
          ? delivery.order.id.slice(0, 8).toUpperCase()
          : '\u2014'}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
        {supplierName ?? '\u2014'}
      </td>
      <td className="px-4 py-3">
        <DeliveryStatusBadge status={delivery.status} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
        {formatDate(displayDate)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 text-center">
        {delivery.items_count ?? 0}
      </td>
    </tr>
  )
}

/** Table header matching DeliveryRow columns */
export function DeliveryRowHeader() {
  return (
    <tr className="border-b border-gray-200 dark:border-gray-800">
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Номер поставки
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Заказ
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Поставщик
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Статус
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Дата
      </th>
      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Позиций
      </th>
    </tr>
  )
}
