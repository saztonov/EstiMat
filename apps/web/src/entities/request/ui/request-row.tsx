'use client'

import { ShoppingCart } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { PurchaseRequestWithRelations } from '../types'
import { RequestStatusBadge } from './request-status-badge'
import { FundingTypeBadge } from './funding-type-badge'

interface RequestRowProps {
  request: PurchaseRequestWithRelations
  onClick?: (request: PurchaseRequestWithRelations) => void
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

export function RequestRow({ request, onClick, className }: RequestRowProps) {
  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/50',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={() => onClick?.(request)}
    >
      {/* Номер заявки */}
      <td className="px-4 py-3 text-sm font-medium text-foreground">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>Заявка #{request.id.slice(0, 8)}</span>
        </div>
      </td>

      {/* Тип финансирования */}
      <td className="px-4 py-3">
        <FundingTypeBadge fundingType={request.funding_type} />
      </td>

      {/* Подрядчик */}
      <td className="px-4 py-3 text-sm text-foreground">
        {request.contractor?.name ?? '\u2014'}
      </td>

      {/* Статус */}
      <td className="px-4 py-3">
        <RequestStatusBadge status={request.status} />
      </td>

      {/* Сумма */}
      <td className="px-4 py-3 text-sm text-right font-medium text-foreground">
        {formatCurrency(request.total)}
      </td>

      {/* Кол-во позиций */}
      <td className="px-4 py-3 text-sm text-center text-muted-foreground">
        {request.items_count ?? '\u2014'}
      </td>

      {/* Дедлайн */}
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {formatDate(request.deadline)}
      </td>
    </tr>
  )
}
