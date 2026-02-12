'use client'

import { cn } from '@/shared/lib/utils'
import type { TenderLotWithRelations } from '@estimat/shared'

interface LotCardProps {
  lot: TenderLotWithRelations
  bestOffer?: number | null
  onClick?: (lot: TenderLotWithRelations) => void
  className?: string
}

function formatQuantity(qty: number, unit: string): string {
  return `${new Intl.NumberFormat('ru-RU').format(qty)} ${unit}`
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

export function LotCard({ lot, bestOffer, onClick, className }: LotCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-4 transition-shadow hover:shadow-md',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={() => onClick?.(lot)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {lot.material?.name ?? 'Материал не указан'}
          </h4>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {lot.material?.unit ?? lot.unit}
          </p>
        </div>
        {lot.requests_count !== undefined && (
          <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-950 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">
            {lot.requests_count} заявок
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Общий объём</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {formatQuantity(lot.total_quantity, lot.unit)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Лучшее предложение</p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {formatAmount(bestOffer)}
          </p>
        </div>
      </div>
    </div>
  )
}
