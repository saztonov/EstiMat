'use client'

import { FolderKanban, Calendar, MapPin, Building2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { StatusBadge } from '@/shared/components/status-badge'
import type { ProjectWithOrg } from '../types'
import { PROJECT_STATUS_LABELS } from './project-status-labels'

interface ProjectCardProps {
  project: ProjectWithOrg
  onClick?: () => void
  className?: string
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '\u2014'
  try {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export function ProjectCard({ project, onClick, className }: ProjectCardProps) {
  const { name, status, start_date, end_date, address, organization } = project

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-4 shadow-sm transition-colors',
        onClick && 'cursor-pointer hover:bg-accent/50',
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FolderKanban className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {name}
            </h3>
            {organization && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Building2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{organization.name}</span>
              </div>
            )}
          </div>
        </div>
        <StatusBadge status={PROJECT_STATUS_LABELS[status] ?? status} />
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          <span>
            {formatDate(start_date)} &mdash; {formatDate(end_date)}
          </span>
        </div>
        {address && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{address}</span>
          </div>
        )}
      </div>
    </div>
  )
}
