'use client'

import { cn } from '@/shared/lib/utils'
import type { BoqStatus } from '@estimat/shared'

const STATUS_CONFIG: Record<BoqStatus, { label: string; className: string }> = {
  draft: {
    label: 'Черновик',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-800/30 dark:text-gray-400',
  },
  review: {
    label: 'На проверке',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  },
  approved: {
    label: 'Утверждён',
    className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
  archived: {
    label: 'Архив',
    className: 'bg-slate-100 text-slate-800 dark:bg-slate-800/30 dark:text-slate-400',
  },
}

interface BoqStatusBadgeProps {
  status: BoqStatus
  className?: string
}

export function BoqStatusBadge({ status, className }: BoqStatusBadgeProps) {
  const config = STATUS_CONFIG[status]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  )
}
