'use client'

import { cn } from '@/shared/lib/utils'
import type { RdVolumeStatus } from '@estimat/shared'

const STATUS_CONFIG: Record<RdVolumeStatus, { label: string; className: string }> = {
  uploaded: {
    label: 'Загружен',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
  verified: {
    label: 'Проверен',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  },
  approved: {
    label: 'Утверждён',
    className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
  rejected: {
    label: 'Отклонён',
    className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  },
}

interface VolumeStatusBadgeProps {
  status: RdVolumeStatus
  className?: string
}

export function VolumeStatusBadge({ status, className }: VolumeStatusBadgeProps) {
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
