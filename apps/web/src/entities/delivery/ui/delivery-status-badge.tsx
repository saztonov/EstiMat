'use client'

import { cn } from '@/shared/lib/utils'
import type { DeliveryStatus } from '@estimat/shared'
import { DELIVERY_STATUS_LABELS } from '../types'

interface DeliveryStatusBadgeProps {
  status: DeliveryStatus
  size?: 'sm' | 'md'
}

const statusStyles: Record<DeliveryStatus, { bg: string; text: string }> = {
  shipped: {
    bg: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-blue-700 dark:text-blue-400',
  },
  delivered: {
    bg: 'bg-green-100 dark:bg-green-950',
    text: 'text-green-700 dark:text-green-400',
  },
  accepted: {
    bg: 'bg-green-100 dark:bg-green-950',
    text: 'text-green-700 dark:text-green-400',
  },
  partially_accepted: {
    bg: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-amber-700 dark:text-amber-400',
  },
  rejected: {
    bg: 'bg-red-100 dark:bg-red-950',
    text: 'text-red-700 dark:text-red-400',
  },
}

export function DeliveryStatusBadge({ status, size = 'sm' }: DeliveryStatusBadgeProps) {
  const style = statusStyles[status] ?? statusStyles.shipped
  const label = DELIVERY_STATUS_LABELS[status] ?? status

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
