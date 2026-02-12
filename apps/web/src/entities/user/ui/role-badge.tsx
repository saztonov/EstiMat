'use client'

import { cn } from '@/shared/lib/utils'
import type { UserRole } from '../types'

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Администратор',
  rd_engineer: 'Инженер ПД',
  estimator: 'Сметчик',
  procurement_manager: 'Менеджер закупок',
  contractor: 'Подрядчик',
  supplier: 'Поставщик',
  finance: 'Финансист',
  project_manager: 'Руководитель проекта',
}

const ROLE_COLORS: Record<UserRole, { bg: string; text: string }> = {
  admin: {
    bg: 'bg-red-100 dark:bg-red-950',
    text: 'text-red-700 dark:text-red-400',
  },
  project_manager: {
    bg: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-blue-700 dark:text-blue-400',
  },
  rd_engineer: {
    bg: 'bg-cyan-100 dark:bg-cyan-950',
    text: 'text-cyan-700 dark:text-cyan-400',
  },
  estimator: {
    bg: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-amber-700 dark:text-amber-400',
  },
  procurement_manager: {
    bg: 'bg-green-100 dark:bg-green-950',
    text: 'text-green-700 dark:text-green-400',
  },
  contractor: {
    bg: 'bg-orange-100 dark:bg-orange-950',
    text: 'text-orange-700 dark:text-orange-400',
  },
  supplier: {
    bg: 'bg-teal-100 dark:bg-teal-950',
    text: 'text-teal-700 dark:text-teal-400',
  },
  finance: {
    bg: 'bg-purple-100 dark:bg-purple-950',
    text: 'text-purple-700 dark:text-purple-400',
  },
}

interface RoleBadgeProps {
  role: UserRole
  className?: string
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  const label = ROLE_LABELS[role] ?? role
  const colors = ROLE_COLORS[role] ?? {
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
