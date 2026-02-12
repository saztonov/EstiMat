'use client'

import type { PurchaseOrderWithRelations } from '@estimat/shared'
import { OrderStatusBadge } from './order-status-badge'

interface OrderRowProps {
  order: PurchaseOrderWithRelations
  onClick?: (order: PurchaseOrderWithRelations) => void
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014'
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatAmount(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '\u2014'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function OrderRow({ order, onClick }: OrderRowProps) {
  return (
    <tr
      className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer transition-colors"
      onClick={() => onClick?.(order)}
    >
      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
        {order.id.slice(0, 8).toUpperCase()}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
        {order.supplier?.name ?? '\u2014'}
      </td>
      <td className="px-4 py-3">
        <OrderStatusBadge status={order.status} />
      </td>
      <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100">
        {formatAmount(order.total)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
        {formatDate(order.delivery_date)}
      </td>
    </tr>
  )
}

/** Table header matching OrderRow columns */
export function OrderRowHeader() {
  return (
    <tr className="border-b border-gray-200 dark:border-gray-800">
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Номер заказа
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Поставщик
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Статус
      </th>
      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Сумма
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Ожидаемая поставка
      </th>
    </tr>
  )
}
