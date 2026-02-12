'use client'

import { cn } from '@/shared/lib/utils'
import type { OrgType } from '../types'

const ORG_TYPE_LABELS: Record<OrgType, string> = {
  client: 'Заказчик',
  general_contractor: 'Генподрядчик',
  subcontractor: 'Субподрядчик',
  supplier: 'Поставщик',
}

const ORG_TYPE_COLORS: Record<OrgType, { bg: string; text: string }> = {
  client: {
    bg: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-blue-700 dark:text-blue-400',
  },
  general_contractor: {
    bg: 'bg-purple-100 dark:bg-purple-950',
    text: 'text-purple-700 dark:text-purple-400',
  },
  subcontractor: {
    bg: 'bg-orange-100 dark:bg-orange-950',
    text: 'text-orange-700 dark:text-orange-400',
  },
  supplier: {
    bg: 'bg-green-100 dark:bg-green-950',
    text: 'text-green-700 dark:text-green-400',
  },
}

interface OrgBadgeProps {
  type: OrgType
  className?: string
}

export function OrgBadge({ type, className }: OrgBadgeProps) {
  const label = ORG_TYPE_LABELS[type] ?? type
  const colors = ORG_TYPE_COLORS[type] ?? {
    bg: 'bg-gray-100 dark:bg-gray-900',
    text: 'text-gray-700 dark:text-gray-400',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        colors.bg,
        colors.text,
        className
      )}
    >
      {label}
    </span>
  )
}

export { ORG_TYPE_LABELS }
