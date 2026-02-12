'use client'

import type { TenderWithRelations } from '@estimat/shared'
import { TenderStatusBadge } from './tender-status-badge'
import { TENDER_TYPE_LABELS } from '../types'

interface TenderRowProps {
  tender: TenderWithRelations
  onClick?: (tender: TenderWithRelations) => void
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014'
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function TenderRow({ tender, onClick }: TenderRowProps) {
  const typeLabel = TENDER_TYPE_LABELS[tender.type] ?? tender.type

  return (
    <tr
      className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer transition-colors"
      onClick={() => onClick?.(tender)}
    >
      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
        {tender.id.slice(0, 8).toUpperCase()}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
        {typeLabel}
      </td>
      <td className="px-4 py-3">
        <TenderStatusBadge status={tender.status} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 text-center">
        {tender.lots_count ?? 0}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
        {formatDate(tender.period_end)}
      </td>
    </tr>
  )
}

/** Table header matching TenderRow columns */
export function TenderRowHeader() {
  return (
    <tr className="border-b border-gray-200 dark:border-gray-800">
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Номер
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Тип
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Статус
      </th>
      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Кол-во лотов
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Дедлайн
      </th>
    </tr>
  )
}
