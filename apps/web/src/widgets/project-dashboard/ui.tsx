'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Building2,
  Calendar,
  MapPin,
  FileText,
  ClipboardList,
  Calculator,
  ShoppingCart,
  Users,
  ArrowRight,
  Clock,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components/page-header'
import { StatusBadge } from '@/shared/components/status-badge'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectDashboardWidgetProps {
  projectId: string
}

interface ProjectData {
  id: string
  name: string
  status: string
  address: string | null
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
  organization?: {
    id: string
    name: string
  } | null
}

interface CountsState {
  volumes: number | null
  boq: number | null
  estimates: number | null
  requests: number | null
}

// ---------------------------------------------------------------------------
// Status labels mapping (mirrors entity layer constant)
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  planning: 'Планирование',
  active: 'Активный',
  completed: 'Завершён',
  archived: 'Архив',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '\u2014'
  try {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
    })
  } catch {
    return dateStr
  }
}

// ---------------------------------------------------------------------------
// Skeleton Loader
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Header skeleton */}
      <div className="mb-6 space-y-2">
        <div className="h-4 w-32 rounded bg-muted" />
        <div className="h-8 w-72 rounded bg-muted" />
      </div>

      {/* Info card skeleton */}
      <div className="mb-6 rounded-lg border border-border bg-card p-6">
        <div className="space-y-3">
          <div className="h-6 w-24 rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-4 w-48 rounded bg-muted" />
            <div className="h-4 w-64 rounded bg-muted" />
            <div className="h-4 w-40 rounded bg-muted" />
          </div>
        </div>
      </div>

      {/* Stat cards skeleton */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted" />
              <div className="space-y-1.5">
                <div className="h-7 w-10 rounded bg-muted" />
                <div className="h-3 w-16 rounded bg-muted" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Nav cards skeleton */}
      <div className="mb-6">
        <div className="mb-3 h-6 w-40 rounded bg-muted" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-muted" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-4 w-20 rounded bg-muted" />
                  <div className="h-3 w-32 rounded bg-muted" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Activity skeleton */}
      <div>
        <div className="mb-3 h-6 w-48 rounded bg-muted" />
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-3/4 rounded bg-muted" />
                  <div className="h-3 w-24 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
  color,
  bgColor,
}: {
  icon: LucideIcon
  label: string
  value: number | null
  loading: boolean
  color: string
  bgColor: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            bgColor
          )}
        >
          <Icon className={cn('h-5 w-5', color)} />
        </div>
        <div>
          {loading ? (
            <div className="h-7 w-10 animate-pulse rounded bg-muted" />
          ) : (
            <div className="text-2xl font-bold text-foreground">
              {value !== null ? value : '\u2014'}
            </div>
          )}
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActivityTimeline
// ---------------------------------------------------------------------------

interface ActivityItem {
  id: string
  icon: LucideIcon
  iconColor: string
  iconBg: string
  text: string
  timestamp: string
}

function ActivityTimeline({ project }: { project: ProjectData }) {
  // Build placeholder activity items based on known project data
  const items: ActivityItem[] = []

  items.push({
    id: 'created',
    icon: Clock,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100 dark:bg-blue-950',
    text: 'Проект создан',
    timestamp: formatDateShort(project.created_at),
  })

  if (project.updated_at && project.updated_at !== project.created_at) {
    items.push({
      id: 'updated',
      icon: Clock,
      iconColor: 'text-amber-600',
      iconBg: 'bg-amber-100 dark:bg-amber-950',
      text: 'Проект обновлён',
      timestamp: formatDateShort(project.updated_at),
    })
  }

  if (project.start_date) {
    const startDate = new Date(project.start_date)
    const now = new Date()
    if (startDate <= now) {
      items.push({
        id: 'started',
        icon: Calendar,
        iconColor: 'text-green-600',
        iconBg: 'bg-green-100 dark:bg-green-950',
        text: 'Начало работ по проекту',
        timestamp: formatDateShort(project.start_date),
      })
    }
  }

  if (project.end_date) {
    const endDate = new Date(project.end_date)
    const now = new Date()
    if (endDate <= now) {
      items.push({
        id: 'ended',
        icon: Calendar,
        iconColor: 'text-gray-600',
        iconBg: 'bg-gray-100 dark:bg-gray-900',
        text: 'Плановое завершение проекта',
        timestamp: formatDateShort(project.end_date),
      })
    }
  }

  // Sort newest first
  items.reverse()

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <Clock className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">
          История действий по проекту будет отображаться здесь
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 px-4 py-3">
            <div
              className={cn(
                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                item.iconBg
              )}
            >
              <item.icon className={cn('h-4 w-4', item.iconColor)} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">{item.text}</p>
              {item.timestamp && (
                <p className="text-xs text-muted-foreground">{item.timestamp}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-border px-4 py-3 text-center">
        <p className="text-xs text-muted-foreground">
          Подробная лента активности появится при добавлении данных в проект
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function ProjectDashboardWidget({ projectId }: ProjectDashboardWidgetProps) {
  const [project, setProject] = useState<ProjectData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [counts, setCounts] = useState<CountsState>({
    volumes: null,
    boq: null,
    estimates: null,
    requests: null,
  })
  const [countsLoading, setCountsLoading] = useState(true)

  // Fetch project details
  useEffect(() => {
    let cancelled = false

    async function fetchProject() {
      setLoading(true)
      setError(null)

      try {
        const res = await fetch(`/api/v1/projects/${projectId}`)
        if (!res.ok) {
          throw new Error(res.status === 404 ? 'Проект не найден' : 'Ошибка загрузки проекта')
        }
        const json = await res.json()
        if (!cancelled) {
          setProject(json.data ?? null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Неизвестная ошибка')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchProject()
    return () => {
      cancelled = true
    }
  }, [projectId])

  // Fetch counts for related entities
  useEffect(() => {
    let cancelled = false

    async function fetchCounts() {
      setCountsLoading(true)

      const endpoints = [
        { key: 'volumes' as const, url: `/api/v1/projects/${projectId}/volumes?limit=1` },
        { key: 'boq' as const, url: `/api/v1/projects/${projectId}/boq?limit=1` },
        { key: 'estimates' as const, url: `/api/v1/projects/${projectId}/estimates?limit=1` },
        { key: 'requests' as const, url: `/api/v1/projects/${projectId}/requests?limit=1` },
      ]

      const results = await Promise.allSettled(
        endpoints.map(async (ep) => {
          const res = await fetch(ep.url)
          if (!res.ok) return { key: ep.key, total: null }
          const json = await res.json()
          return { key: ep.key, total: json.meta?.total ?? null }
        })
      )

      if (!cancelled) {
        const newCounts: CountsState = { volumes: null, boq: null, estimates: null, requests: null }
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.total !== null) {
            newCounts[result.value.key] = result.value.total
          }
        }
        setCounts(newCounts)
        setCountsLoading(false)
      }
    }

    fetchCounts()
    return () => {
      cancelled = true
    }
  }, [projectId])

  // --- Loading state ---
  if (loading) {
    return <DashboardSkeleton />
  }

  // --- Error state ---
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <p className="mt-3 text-sm font-medium text-foreground">Ошибка</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Link
          href="/projects"
          className="mt-4 inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-muted"
        >
          Вернуться к проектам
        </Link>
      </div>
    )
  }

  // --- Not found state ---
  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Проект не найден</p>
        <Link
          href="/projects"
          className="mt-4 inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-muted"
        >
          Вернуться к проектам
        </Link>
      </div>
    )
  }

  // --- Navigation links ---
  const navLinks: {
    href: string
    icon: LucideIcon
    label: string
    description: string
  }[] = [
    {
      href: `/projects/${projectId}/volumes`,
      icon: FileText,
      label: 'Тома РД',
      description: 'Рабочая документация',
    },
    {
      href: `/projects/${projectId}/boq`,
      icon: ClipboardList,
      label: 'ВОР',
      description: 'Ведомости объёмов работ',
    },
    {
      href: `/projects/${projectId}/estimates`,
      icon: Calculator,
      label: 'Сметы',
      description: 'Сметная документация',
    },
    {
      href: `/projects/${projectId}/requests`,
      icon: ShoppingCart,
      label: 'Заявки',
      description: 'Заявки на материалы',
    },
    {
      href: `/projects/${projectId}/members`,
      icon: Users,
      label: 'Участники',
      description: 'Команда проекта',
    },
  ]

  // --- Status label ---
  const statusLabel = STATUS_LABELS[project.status] ?? project.status

  return (
    <div>
      {/* Page header with breadcrumbs */}
      <PageHeader
        title={project.name}
        breadcrumbs={[
          { label: 'Проекты', href: '/projects' },
          { label: project.name },
        ]}
        actions={
          <StatusBadge status={statusLabel} size="md" />
        }
      />

      {/* Project info card */}
      <div className="mb-6 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            {project.organization && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Building2 className="h-4 w-4 shrink-0" />
                <span>{project.organization.name}</span>
              </div>
            )}

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4 shrink-0" />
              <span>
                {formatDate(project.start_date)} {'\u2014'} {formatDate(project.end_date)}
              </span>
            </div>

            {project.address && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0" />
                <span>{project.address}</span>
              </div>
            )}
          </div>

          {/* Date progress indicator */}
          {project.start_date && project.end_date && (
            <DateProgress startDate={project.start_date} endDate={project.end_date} />
          )}
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={FileText}
          label="Тома РД"
          value={counts.volumes}
          loading={countsLoading}
          color="text-blue-600"
          bgColor="bg-blue-100 dark:bg-blue-950"
        />
        <StatCard
          icon={ClipboardList}
          label="ВОР"
          value={counts.boq}
          loading={countsLoading}
          color="text-amber-600"
          bgColor="bg-amber-100 dark:bg-amber-950"
        />
        <StatCard
          icon={Calculator}
          label="Сметы"
          value={counts.estimates}
          loading={countsLoading}
          color="text-green-600"
          bgColor="bg-green-100 dark:bg-green-950"
        />
        <StatCard
          icon={ShoppingCart}
          label="Заявки"
          value={counts.requests}
          loading={countsLoading}
          color="text-purple-600"
          bgColor="bg-purple-100 dark:bg-purple-950"
        />
      </div>

      {/* Navigation section */}
      <div className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-foreground">Разделы проекта</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <link.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{link.label}</div>
                <div className="text-xs text-muted-foreground">{link.description}</div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </div>

      {/* Activity timeline */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Последняя активность</h2>
        <ActivityTimeline project={project} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DateProgress — mini visual for project timeline
// ---------------------------------------------------------------------------

function DateProgress({ startDate, endDate }: { startDate: string; endDate: string }) {
  const start = new Date(startDate).getTime()
  const end = new Date(endDate).getTime()
  const now = Date.now()

  if (end <= start) return null

  const total = end - start
  const elapsed = now - start
  const pct = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)))

  const isOverdue = now > end
  const hasNotStarted = now < start

  let label: string
  if (hasNotStarted) {
    label = 'Ещё не начат'
  } else if (isOverdue) {
    label = 'Срок завершён'
  } else {
    label = `${pct}% срока`
  }

  return (
    <div className="w-full max-w-xs shrink-0">
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            isOverdue
              ? 'bg-destructive'
              : hasNotStarted
                ? 'bg-muted-foreground/30'
                : 'bg-primary'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
