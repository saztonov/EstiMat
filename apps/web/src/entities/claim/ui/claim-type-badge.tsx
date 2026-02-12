'use client'

import { cn } from '@/shared/lib/utils'
import type { ClaimType } from '@estimat/shared'
import { CLAIM_TYPE_LABELS } from '../types'

interface ClaimTypeBadgeProps {
  type: ClaimType
  size?: 'sm' | 'md'
}

const typeStyles: Record<ClaimType, { bg: string; text: string }> = {
  quantity: {
    bg: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-amber-700 dark:text-amber-400',
  },
  quality: {
    bg: 'bg-red-100 dark:bg-red-950',
    text: 'text-red-700 dark:text-red-400',
  },
  damage: {
    bg: 'bg-red-100 dark:bg-red-950',
    text: 'text-red-700 dark:text-red-400',
  },
  delay: {
    bg: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-blue-700 dark:text-blue-400',
  },
  other: {
    bg: 'bg-gray-100 dark:bg-gray-900',
    text: 'text-gray-700 dark:text-gray-400',
  },
}

export function ClaimTypeBadge({ type, size = 'sm' }: ClaimTypeBadgeProps) {
  const style = typeStyles[type] ?? typeStyles.other
  const label = CLAIM_TYPE_LABELS[type] ?? type

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
