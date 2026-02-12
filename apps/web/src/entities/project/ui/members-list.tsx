'use client'

import { Users, Trash2, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useProjectMembers } from '../api/queries'
import { useRemoveProjectMember } from '../api/mutations'
import type { ProjectMemberWithUser } from '../types'

const MEMBER_ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  director: 'Директор',
  project_manager: 'Руководитель проекта',
  engineer: 'Инженер',
  estimator: 'Сметчик',
  procurement: 'Снабженец',
  warehouse: 'Кладовщик',
  viewer: 'Наблюдатель',
  rd_engineer: 'Инженер ПД',
  procurement_manager: 'Менеджер закупок',
  contractor: 'Подрядчик',
  supplier: 'Поставщик',
  finance: 'Финансист',
}

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  admin: {
    bg: 'bg-red-100 dark:bg-red-950',
    text: 'text-red-700 dark:text-red-400',
  },
  director: {
    bg: 'bg-purple-100 dark:bg-purple-950',
    text: 'text-purple-700 dark:text-purple-400',
  },
  project_manager: {
    bg: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-blue-700 dark:text-blue-400',
  },
  engineer: {
    bg: 'bg-cyan-100 dark:bg-cyan-950',
    text: 'text-cyan-700 dark:text-cyan-400',
  },
  estimator: {
    bg: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-amber-700 dark:text-amber-400',
  },
  procurement: {
    bg: 'bg-green-100 dark:bg-green-950',
    text: 'text-green-700 dark:text-green-400',
  },
}

function MemberRoleBadge({ role }: { role: string }) {
  const label = MEMBER_ROLE_LABELS[role] ?? role
  const colors = ROLE_COLORS[role] ?? {
    bg: 'bg-gray-100 dark:bg-gray-900',
    text: 'text-gray-700 dark:text-gray-400',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        colors.bg,
        colors.text
      )}
    >
      {label}
    </span>
  )
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

interface MembersListProps {
  projectId: string
  canRemove?: boolean
  className?: string
}

export function MembersList({
  projectId,
  canRemove = false,
  className,
}: MembersListProps) {
  const { data: members = [], isLoading } = useProjectMembers(projectId)
  const removeMember = useRemoveProjectMember()

  function handleRemove(member: ProjectMemberWithUser) {
    if (
      window.confirm(
        `Удалить участника ${member.user?.full_name ?? 'Без имени'} из проекта?`
      )
    ) {
      removeMember.mutate({
        projectId: member.project_id,
        memberId: member.id,
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Загрузка участников...
        </span>
      </div>
    )
  }

  if (members.length === 0) {
    return (
      <div className={cn('py-8 text-center', className)}>
        <Users className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">
          Участники не добавлены
        </p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      {members.map((member) => (
        <div
          key={member.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              {getInitials(member.user?.full_name ?? '?')}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {member.user?.full_name ?? 'Без имени'}
              </div>
              {member.user?.email && (
                <div className="truncate text-xs text-muted-foreground">
                  {member.user.email}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <MemberRoleBadge role={member.role} />
            {canRemove && (
              <button
                type="button"
                onClick={() => handleRemove(member)}
                disabled={removeMember.isPending}
                className={cn(
                  'rounded-md p-1.5 text-muted-foreground transition-colors',
                  'hover:bg-destructive/10 hover:text-destructive',
                  'disabled:pointer-events-none disabled:opacity-50'
                )}
                aria-label={`Удалить ${member.user?.full_name ?? 'участника'}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
