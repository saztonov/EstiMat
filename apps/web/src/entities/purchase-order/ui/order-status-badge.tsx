'use client'

import { cn } from '@/shared/lib/utils'
import type { PoStatus } from '@estimat/shared'
import { PO_STATUS_LABELS } from '../types'

interface OrderStatusBadgeProps {
  status: PoStatus
  size?: 'sm' | 'md'
}

const statusStyles: Record<PoStatus, { bg: string; text: string }> = {
  draft: {
    bg: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-amber-700 dark:text-amber-400',
  },
  confirmed: {
    bg: 'bg-green-100 dark:bg-green-950',
    text: 'text-green-700 dark:text-green-400',
  },
  in_delivery: {
    bg: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-blue-700 dark:text-blue-400',
  },
  delivered: {
    bg: 'bg-green-100 dark:bg-green-950',
    text: 'text-green-700 dark:text-green-400',
  },
  closed: {
    bg: 'bg-gray-100 dark:bg-gray-900',
    text: 'text-gray-700 dark:text-gray-400',
  },
  cancelled: {
    bg: 'bg-red-100 dark:bg-red-950',
    text: 'text-red-700 dark:text-red-400',
  },
}

export function OrderStatusBadge({ status, size = 'sm' }: OrderStatusBadgeProps) {
  const style = statusStyles[status] ?? statusStyles.draft
  const label = PO_STATUS_LABELS[status] ?? status

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium whitespace-nowrap',
        size === 'sm' && 'px-2 py-0.5 text-xs',
        size === 'md' && 'px-2.5 py-1 text-sm',
        style.bg,
        style.text
      )}
    >
      {label}
    </span>
  )
}
