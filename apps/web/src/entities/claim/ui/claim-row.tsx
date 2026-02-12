'use client'

import type { ClaimWithRelations } from '@estimat/shared'
import { ClaimTypeBadge } from './claim-type-badge'
import { cn } from '@/shared/lib/utils'
import { CLAIM_STATUS_LABELS } from '../types'
import type { ClaimStatus } from '@estimat/shared'

interface ClaimRowProps {
  claim: ClaimWithRelations
  onClick?: (claim: ClaimWithRelations) => void
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

const claimStatusStyles: Record<ClaimStatus, { bg: string; text: string }> = {
  open: {
    bg: 'bg-red-100 dark:bg-red-950',
    text: 'text-red-700 dark:text-red-400',
  },
  in_progress: {
    bg: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-amber-700 dark:text-amber-400',
  },
  resolved: {
    bg: 'bg-green-100 dark:bg-green-950',
    text: 'text-green-700 dark:text-green-400',
  },
  closed: {
    bg: 'bg-gray-100 dark:bg-gray-900',
    text: 'text-gray-700 dark:text-gray-400',
  },
}

function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  const style = claimStatusStyles[status] ?? claimStatusStyles.open
  const label = CLAIM_STATUS_LABELS[status] ?? status

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        style.bg,
        style.text
      )}
    >
      {label}
    </span>
  )
}

export function ClaimRow({ claim, onClick }: ClaimRowProps) {
  return (
    <tr
      className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer transition-colors"
      onClick={() => onClick?.(claim)}
    >
      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
        {claim.id.slice(0, 8).toUpperCase()}
      </td>
      <td className="px-4 py-3">
        <ClaimTypeBadge type={claim.type} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
        {claim.delivery?.id
          ? claim.delivery.id.slice(0, 8).toUpperCase()
          : '\u2014'}
      </td>
      <td className="px-4 py-3">
        <ClaimStatusBadge status={claim.status} />
      </td>
      <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100">
        {formatAmount(claim.amount)}
      </td>
    </tr>
  )
}

/** Table header matching ClaimRow columns */
export function ClaimRowHeader() {
  return (
    <tr className="border-b border-gray-200 dark:border-gray-800">
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Номер
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Тип
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Поставка
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Статус
      </th>
      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Сумма
      </th>
    </tr>
  )
}
