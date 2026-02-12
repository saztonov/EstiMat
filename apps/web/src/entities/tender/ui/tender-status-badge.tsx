'use client'

import { cn } from '@/shared/lib/utils'
import type { TenderStatus } from '@estimat/shared'
import { TENDER_STATUS_LABELS } from '../types'

interface TenderStatusBadgeProps {
  status: TenderStatus
  size?: 'sm' | 'md'
}

const statusStyles: Record<TenderStatus, { bg: string; text: string }> = {
  draft: {
    bg: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-amber-700 dark:text-amber-400',
  },
  published: {
    bg: 'bg-green-100 dark:bg-green-950',
    text: 'text-green-700 dark:text-green-400',
  },
  bidding: {
    bg: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-blue-700 dark:text-blue-400',
  },
  evaluation: {
    bg: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-amber-700 dark:text-amber-400',
  },
  awarded: {
    bg: 'bg-green-100 dark:bg-green-950',
    text: 'text-green-700 dark:text-green-400',
  },
  completed: {
    bg: 'bg-gray-100 dark:bg-gray-900',
    text: 'text-gray-700 dark:text-gray-400',
  },
  cancelled: {
    bg: 'bg-red-100 dark:bg-red-950',
    text: 'text-red-700 dark:text-red-400',
  },
}

export function TenderStatusBadge({ status, size = 'sm' }: TenderStatusBadgeProps) {
  const style = statusStyles[status] ?? statusStyles.draft
  const label = TENDER_STATUS_LABELS[status] ?? status

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
