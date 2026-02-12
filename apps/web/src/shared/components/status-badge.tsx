'use client'

import { cn } from '@/shared/lib/utils'

interface StatusBadgeProps {
  status: string
  variant?: 'default' | 'outline'
  size?: 'sm' | 'md'
}

type ColorScheme = {
  bg: string
  text: string
  border: string
}

const colorMap: Record<string, ColorScheme> = {
  // Green statuses
  approved: { bg: 'bg-green-100 dark:bg-green-950', text: 'text-green-700 dark:text-green-400', border: 'border-green-300 dark:border-green-700' },
  confirmed: { bg: 'bg-green-100 dark:bg-green-950', text: 'text-green-700 dark:text-green-400', border: 'border-green-300 dark:border-green-700' },
  delivered: { bg: 'bg-green-100 dark:bg-green-950', text: 'text-green-700 dark:text-green-400', border: 'border-green-300 dark:border-green-700' },
  accepted: { bg: 'bg-green-100 dark:bg-green-950', text: 'text-green-700 dark:text-green-400', border: 'border-green-300 dark:border-green-700' },
  completed: { bg: 'bg-green-100 dark:bg-green-950', text: 'text-green-700 dark:text-green-400', border: 'border-green-300 dark:border-green-700' },
  active: { bg: 'bg-green-100 dark:bg-green-950', text: 'text-green-700 dark:text-green-400', border: 'border-green-300 dark:border-green-700' },
  published: { bg: 'bg-green-100 dark:bg-green-950', text: 'text-green-700 dark:text-green-400', border: 'border-green-300 dark:border-green-700' },
  awarded: { bg: 'bg-green-100 dark:bg-green-950', text: 'text-green-700 dark:text-green-400', border: 'border-green-300 dark:border-green-700' },

  // Yellow/amber statuses
  pending: { bg: 'bg-amber-100 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-300 dark:border-amber-700' },
  draft: { bg: 'bg-amber-100 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-300 dark:border-amber-700' },
  submitted: { bg: 'bg-amber-100 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-300 dark:border-amber-700' },
  in_review: { bg: 'bg-amber-100 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-300 dark:border-amber-700' },
  processing: { bg: 'bg-amber-100 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-300 dark:border-amber-700' },
  in_progress: { bg: 'bg-amber-100 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-300 dark:border-amber-700' },
  verification: { bg: 'bg-amber-100 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-300 dark:border-amber-700' },
  collecting_offers: { bg: 'bg-amber-100 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-300 dark:border-amber-700' },
  in_tender: { bg: 'bg-amber-100 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-300 dark:border-amber-700' },

  // Red statuses
  rejected: { bg: 'bg-red-100 dark:bg-red-950', text: 'text-red-700 dark:text-red-400', border: 'border-red-300 dark:border-red-700' },
  cancelled: { bg: 'bg-red-100 dark:bg-red-950', text: 'text-red-700 dark:text-red-400', border: 'border-red-300 dark:border-red-700' },
  overdue: { bg: 'bg-red-100 dark:bg-red-950', text: 'text-red-700 dark:text-red-400', border: 'border-red-300 dark:border-red-700' },
  disputed: { bg: 'bg-red-100 dark:bg-red-950', text: 'text-red-700 dark:text-red-400', border: 'border-red-300 dark:border-red-700' },
  write_off: { bg: 'bg-red-100 dark:bg-red-950', text: 'text-red-700 dark:text-red-400', border: 'border-red-300 dark:border-red-700' },

  // Blue statuses
  new: { bg: 'bg-blue-100 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-300 dark:border-blue-700' },
  uploaded: { bg: 'bg-blue-100 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-300 dark:border-blue-700' },
  verified: { bg: 'bg-blue-100 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-300 dark:border-blue-700' },
  signed: { bg: 'bg-blue-100 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-300 dark:border-blue-700' },
  shipped: { bg: 'bg-blue-100 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-300 dark:border-blue-700' },
  sent: { bg: 'bg-blue-100 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-300 dark:border-blue-700' },

  // Gray statuses
  archived: { bg: 'bg-gray-100 dark:bg-gray-900', text: 'text-gray-700 dark:text-gray-400', border: 'border-gray-300 dark:border-gray-700' },
  closed: { bg: 'bg-gray-100 dark:bg-gray-900', text: 'text-gray-700 dark:text-gray-400', border: 'border-gray-300 dark:border-gray-700' },
  inactive: { bg: 'bg-gray-100 dark:bg-gray-900', text: 'text-gray-700 dark:text-gray-400', border: 'border-gray-300 dark:border-gray-700' },
}

const defaultColor: ColorScheme = {
  bg: 'bg-gray-100 dark:bg-gray-900',
  text: 'text-gray-700 dark:text-gray-400',
  border: 'border-gray-300 dark:border-gray-700',
}

/** Format a raw status key for display: replace underscores with spaces and capitalize first letter */
function formatStatus(status: string): string {
  const formatted = status.replace(/_/g, ' ')
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

export function StatusBadge({ status, variant = 'default', size = 'sm' }: StatusBadgeProps) {
  const normalizedStatus = status.toLowerCase().trim()
  const colors = colorMap[normalizedStatus] ?? defaultColor

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium whitespace-nowrap',
        size === 'sm' && 'px-2 py-0.5 text-xs',
        size === 'md' && 'px-2.5 py-1 text-sm',
        colors.text,
        variant === 'default' && colors.bg,
        variant === 'outline' && `border ${colors.border} bg-transparent`
      )}
    >
      {formatStatus(status)}
    </span>
  )
}
