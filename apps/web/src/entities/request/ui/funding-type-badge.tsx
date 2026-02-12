'use client'

import { cn } from '@/shared/lib/utils'
import type { FundingType } from '@estimat/shared'

const FUNDING_CONFIG: Record<FundingType, { label: string; className: string }> = {
  gp_supply: {
    label: 'Снабжение ГП',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
  obs_letter: {
    label: 'Распред. письмо',
    className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  },
  advance: {
    label: 'Авансирование',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  },
}

interface FundingTypeBadgeProps {
  fundingType: FundingType
  className?: string
}

export function FundingTypeBadge({ fundingType, className }: FundingTypeBadgeProps) {
  const config = FUNDING_CONFIG[fundingType]

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
