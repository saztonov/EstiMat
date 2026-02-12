'use client'

import { FileSpreadsheet } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { EstimateWithRelations } from '../types'
import { EstimateStatusBadge } from './estimate-status-badge'

interface EstimateRowProps {
  estimate: EstimateWithRelations
  onClick?: (estimate: EstimateWithRelations) => void
  className?: string
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '\u2014'
  return new Date(dateString).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'KZT',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

export function EstimateRow({ estimate, onClick, className }: EstimateRowProps) {
  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/50',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={() => onClick?.(estimate)}
    >
      {/* Номер / ID сметы */}
      <td className="px-4 py-3 text-sm font-medium text-foreground">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{estimate.work_type ?? `Смета #${estimate.id.slice(0, 8)}`}</span>
        </div>
      </td>

      {/* Подрядчик */}
      <td className="px-4 py-3 text-sm text-foreground">
        {estimate.contractor?.name ?? '\u2014'}
      </td>

      {/* Статус */}
      <td className="px-4 py-3">
        <EstimateStatusBadge status={estimate.status} />
      </td>

      {/* Сумма */}
      <td className="px-4 py-3 text-sm text-right font-medium text-foreground">
        {formatCurrency(estimate.total_amount)}
      </td>

      {/* Кол-во позиций */}
      <td className="px-4 py-3 text-sm text-center text-muted-foreground">
        {estimate.items_count ?? '\u2014'}
      </td>

      {/* Дата создания */}
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {formatDate(estimate.created_at)}
      </td>

      {/* Дата утверждения */}
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {formatDate(estimate.approved_at)}
      </td>
    </tr>
  )
}
