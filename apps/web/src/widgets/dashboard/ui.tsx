'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  FolderKanban,
  FileText,
  Gavel,
  Truck,
  ClipboardCheck,
  Calculator,
  ShoppingCart,
  Megaphone,
  PackageCheck,
  ArrowRight,
  Activity,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components/page-header'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiResponse<T> {
  data: T[] | null
  meta?: { total: number; page: number; limit: number }
  error?: string
}

interface ProjectRow {
  id: string
  name: string
  status: string
  address: string | null
  start_date: string | null
  end_date: string | null
  organization?: { id: string; name: string } | null
}

interface TenderRow {
  id: string
  status: string
  title?: string
  created_at: string
  project?: { id: string; name: string } | null
}

interface PurchaseOrderRow {
  id: string
  status: string
  created_at: string
  supplier?: { id: string; name: string } | null
  project?: { id: string; name: string } | null
}

interface DeliveryRow {
  id: string
  status: string
  created_at: string
  project?: { id: string; name: string } | null
}

interface DashboardData {
  projects: ProjectRow[]
  tenders: TenderRow[]
  purchaseOrders: PurchaseOrderRow[]
  deliveries: DeliveryRow[]
  totalProjects: number
  totalTenders: number
  totalOrders: number
  totalDeliveries: number
}

interface FunnelStage {
  label: string
  count: number
  icon: LucideIcon
  color: string
}

interface ActivityItem {
  id: string
  text: string
  timestamp: string
  type: 'project' | 'tender' | 'order' | 'delivery'
}

// ---------------------------------------------------------------------------
// Data fetching helper
// ---------------------------------------------------------------------------

async function fetchApi<T>(url: string): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      return { data: null, error: `HTTP ${res.status}` }
    }
    return await res.json()
  } catch {
    return { data: null, error: 'Ошибка сети' }
  }
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function DashboardWidget() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [projectsRes, tendersRes, ordersRes, deliveriesRes] = await Promise.all([
        fetchApi<ProjectRow>('/api/v1/projects?limit=50'),
        fetchApi<TenderRow>('/api/v1/tenders?limit=50'),
        fetchApi<PurchaseOrderRow>('/api/v1/purchase-orders?limit=50'),
        fetchApi<DeliveryRow>('/api/v1/deliveries?limit=50'),
      ])

      const hasError = [projectsRes, tendersRes, ordersRes, deliveriesRes].find((r) => r.error)
      if (hasError?.error) {
        setError(hasError.error)
      }

      setData({
        projects: projectsRes.data ?? [],
        tenders: tendersRes.data ?? [],
        purchaseOrders: ordersRes.data ?? [],
        deliveries: deliveriesRes.data ?? [],
        totalProjects: projectsRes.meta?.total ?? projectsRes.data?.length ?? 0,
        totalTenders: tendersRes.meta?.total ?? tendersRes.data?.length ?? 0,
        totalOrders: ordersRes.meta?.total ?? ordersRes.data?.length ?? 0,
        totalDeliveries: deliveriesRes.meta?.total ?? deliveriesRes.data?.length ?? 0,
      })
    } catch {
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // -------------------------------------------------------------------------
  // Derived stats
  // -------------------------------------------------------------------------

  const activeProjects = data?.projects.filter((p) => p.status === 'active').length ?? 0

  const pendingRequests = data?.purchaseOrders.filter(
    (o) => o.status === 'draft' || o.status === 'confirmed'
  ).length ?? 0

  const activeTenders = data?.tenders.filter(
    (t) => t.status === 'published' || t.status === 'bidding' || t.status === 'evaluation'
  ).length ?? 0

  const shipmentsInTransit = data?.deliveries.filter((d) => d.status === 'shipped').length ?? 0

  // -------------------------------------------------------------------------
  // Funnel stages
  // -------------------------------------------------------------------------

  const funnelStages: FunnelStage[] = data
    ? [
        {
          label: 'ВОР на проверке',
          count: 0, // volumes not fetched on dashboard, placeholder
          icon: ClipboardCheck,
          color: 'bg-slate-500',
        },
        {
          label: 'Сметы на согласовании',
          count: 0, // estimates not fetched on dashboard, placeholder
          icon: Calculator,
          color: 'bg-amber-500',
        },
        {
          label: 'Заявки в обработке',
          count: data.purchaseOrders.filter(
            (o) => o.status === 'draft' || o.status === 'confirmed'
          ).length,
          icon: ShoppingCart,
          color: 'bg-orange-500',
        },
        {
          label: 'Тендеры открыты',
          count: data.tenders.filter(
            (t) => t.status === 'published' || t.status === 'bidding'
          ).length,
          icon: Megaphone,
          color: 'bg-blue-500',
        },
        {
          label: 'Заказы подтверждены',
          count: data.purchaseOrders.filter((o) => o.status === 'confirmed').length,
          icon: PackageCheck,
          color: 'bg-emerald-500',
        },
        {
          label: 'Поставки в пути',
          count: data.deliveries.filter((d) => d.status === 'shipped').length,
          icon: Truck,
          color: 'bg-violet-500',
        },
      ]
    : []

  // -------------------------------------------------------------------------
  // Activity feed
  // -------------------------------------------------------------------------

  const activityFeed: ActivityItem[] = data
    ? buildActivityFeed(data)
    : []

  // -------------------------------------------------------------------------
  // Project progress
  // -------------------------------------------------------------------------

  const projectsWithProgress = data
    ? data.projects
        .filter((p) => p.status === 'active' || p.status === 'planning')
        .slice(0, 8)
        .map((p) => ({
          ...p,
          progress: computeProjectProgress(p),
        }))
    : []

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div>
      <PageHeader
        title="Панель управления"
        description="Обзор текущего состояния закупок"
      />

      {/* Error banner */}
      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={loadData}
            className="ml-auto text-sm font-medium text-destructive underline hover:no-underline"
          >
            Повторить
          </button>
        </div>
      )}

      {/* Row 1 - Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Активные проекты"
          value={activeProjects}
          icon={FolderKanban}
          loading={loading}
          accentColor="text-blue-500"
          accentBg="bg-blue-500/10"
        />
        <SummaryCard
          title="Заявки на рассмотрении"
          value={pendingRequests}
          icon={FileText}
          loading={loading}
          accentColor="text-amber-500"
          accentBg="bg-amber-500/10"
        />
        <SummaryCard
          title="Активные тендеры"
          value={activeTenders}
          icon={Gavel}
          loading={loading}
          accentColor="text-emerald-500"
          accentBg="bg-emerald-500/10"
        />
        <SummaryCard
          title="Поставки в пути"
          value={shipmentsInTransit}
          icon={Truck}
          loading={loading}
          accentColor="text-violet-500"
          accentBg="bg-violet-500/10"
        />
      </div>

      {/* Row 2 - Funnel + Activity */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Procurement funnel */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-4 text-base font-semibold text-foreground">Воронка закупок</h2>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonBar key={i} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {funnelStages.map((stage) => (
                <FunnelRow key={stage.label} stage={stage} />
              ))}
            </div>
          )}
        </div>

        {/* Activity feed */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-4 text-base font-semibold text-foreground">Последние действия</h2>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonBar key={i} />
              ))}
            </div>
          ) : activityFeed.length > 0 ? (
            <div className="space-y-1">
              {activityFeed.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <EmptyState message="Нет недавних действий" />
          )}
        </div>
      </div>

      {/* Row 3 - Projects with progress */}
      <div className="mt-6 rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Проекты</h2>
          {!loading && data && data.totalProjects > 0 && (
            <span className="text-xs text-muted-foreground">
              Всего: {data.totalProjects}
            </span>
          )}
        </div>
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonProjectRow key={i} />
            ))}
          </div>
        ) : projectsWithProgress.length > 0 ? (
          <div className="space-y-3">
            {projectsWithProgress.map((project) => (
              <ProjectProgressRow key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <EmptyState message="Нет активных проектов" />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

function SummaryCard({
  title,
  value,
  icon: Icon,
  loading,
  accentColor,
  accentBg,
}: {
  title: string
  value: number
  icon: LucideIcon
  loading: boolean
  accentColor: string
  accentBg: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {loading ? (
            <div className="mt-2 h-8 w-16 animate-pulse rounded bg-muted" />
          ) : (
            <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">{value}</p>
          )}
        </div>
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', accentBg)}>
          <Icon className={cn('h-5 w-5', accentColor)} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Funnel row
// ---------------------------------------------------------------------------

function FunnelRow({ stage }: { stage: FunnelStage }) {
  const Icon = stage.icon

  return (
    <div className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/50">
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', stage.color + '/10')}>
        <Icon className={cn('h-4 w-4', stage.color.replace('bg-', 'text-'))} />
      </div>
      <span className="flex-1 text-sm text-foreground">{stage.label}</span>
      <span className="min-w-[2rem] text-right text-sm font-semibold tabular-nums text-foreground">
        {stage.count}
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activity row
// ---------------------------------------------------------------------------

const ACTIVITY_TYPE_ICONS: Record<ActivityItem['type'], LucideIcon> = {
  project: FolderKanban,
  tender: Gavel,
  order: FileText,
  delivery: Truck,
}

const ACTIVITY_TYPE_COLORS: Record<ActivityItem['type'], string> = {
  project: 'text-blue-500',
  tender: 'text-emerald-500',
  order: 'text-amber-500',
  delivery: 'text-violet-500',
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const Icon = ACTIVITY_TYPE_ICONS[item.type]
  const color = ACTIVITY_TYPE_COLORS[item.type]

  return (
    <div className="flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/50">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
        <Icon className={cn('h-4 w-4', color)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{item.text}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{item.timestamp}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project progress row
// ---------------------------------------------------------------------------

function ProjectProgressRow({
  project,
}: {
  project: ProjectRow & { progress: number }
}) {
  const statusLabel = PROJECT_STATUS_LABELS_LOCAL[project.status] ?? project.status
  const progressColor =
    project.progress >= 75
      ? 'bg-emerald-500'
      : project.progress >= 40
        ? 'bg-amber-500'
        : 'bg-blue-500'

  return (
    <div className="rounded-md border border-border/50 px-4 py-3 transition-colors hover:bg-muted/30">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{project.name}</span>
            <span
              className={cn(
                'inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                project.status === 'active'
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : project.status === 'planning'
                    ? 'bg-blue-500/10 text-blue-600'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              {statusLabel}
            </span>
          </div>
          {project.organization?.name && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {project.organization.name}
            </p>
          )}
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
          {project.progress}%
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all duration-500', progressColor)}
          style={{ width: `${project.progress}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton components
// ---------------------------------------------------------------------------

function SkeletonBar() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="h-8 w-8 animate-pulse rounded-md bg-muted" />
      <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
      <div className="h-4 w-8 animate-pulse rounded bg-muted" />
    </div>
  )
}

function SkeletonProjectRow() {
  return (
    <div className="rounded-md border border-border/50 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-4 w-10 animate-pulse rounded bg-muted" />
      </div>
      <div className="mt-2 h-1.5 w-full animate-pulse rounded-full bg-muted" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <Activity className="mb-2 h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_STATUS_LABELS_LOCAL: Record<string, string> = {
  planning: 'Планирование',
  active: 'Активный',
  completed: 'Завершён',
  archived: 'Архив',
}

function computeProjectProgress(project: ProjectRow): number {
  if (project.status === 'completed') return 100
  if (project.status === 'archived') return 100

  if (!project.start_date) {
    return project.status === 'active' ? 15 : 0
  }

  const start = new Date(project.start_date).getTime()
  const now = Date.now()

  if (!project.end_date) {
    // No end date, estimate progress from elapsed time (cap at 90%)
    const elapsedDays = Math.max(0, (now - start) / (1000 * 60 * 60 * 24))
    return Math.min(90, Math.round(elapsedDays / 3))
  }

  const end = new Date(project.end_date).getTime()
  if (end <= start) return 50

  const total = end - start
  const elapsed = now - start
  const pct = Math.round((elapsed / total) * 100)

  return Math.max(0, Math.min(95, pct))
}

function buildActivityFeed(data: DashboardData): ActivityItem[] {
  const items: ActivityItem[] = []

  // Recent projects
  for (const p of data.projects.slice(0, 3)) {
    const statusLabel = PROJECT_STATUS_LABELS_LOCAL[p.status] ?? p.status
    items.push({
      id: `p-${p.id}`,
      text: `Проект "${p.name}" — ${statusLabel}`,
      timestamp: formatProjectDate(p),
      type: 'project',
    })
  }

  // Recent tenders
  for (const t of data.tenders.slice(0, 3)) {
    const statusLabel = TENDER_STATUS_LABELS_LOCAL[t.status] ?? t.status
    const projectName = t.project?.name ? ` (${t.project.name})` : ''
    items.push({
      id: `t-${t.id}`,
      text: `Тендер${projectName} — ${statusLabel}`,
      timestamp: formatTimestamp(t.created_at),
      type: 'tender',
    })
  }

  // Recent orders
  for (const o of data.purchaseOrders.slice(0, 2)) {
    const statusLabel = PO_STATUS_LABELS_LOCAL[o.status] ?? o.status
    const supplierName = o.supplier?.name ? ` от ${o.supplier.name}` : ''
    items.push({
      id: `o-${o.id}`,
      text: `Заказ${supplierName} — ${statusLabel}`,
      timestamp: formatTimestamp(o.created_at),
      type: 'order',
    })
  }

  // Recent deliveries
  for (const d of data.deliveries.slice(0, 2)) {
    const statusLabel = DELIVERY_STATUS_LABELS_LOCAL[d.status] ?? d.status
    const projectName = d.project?.name ? ` (${d.project.name})` : ''
    items.push({
      id: `d-${d.id}`,
      text: `Поставка${projectName} — ${statusLabel}`,
      timestamp: formatTimestamp(d.created_at),
      type: 'delivery',
    })
  }

  // Sort by timestamp descending (most recent first)
  items.sort((a, b) => {
    const da = parseDisplayDate(a.timestamp)
    const db = parseDisplayDate(b.timestamp)
    return db - da
  })

  return items.slice(0, 8)
}

const TENDER_STATUS_LABELS_LOCAL: Record<string, string> = {
  draft: 'Черновик',
  published: 'Опубликован',
  bidding: 'Сбор предложений',
  evaluation: 'Оценка',
  awarded: 'Определён победитель',
  completed: 'Завершён',
  cancelled: 'Отменён',
}

const PO_STATUS_LABELS_LOCAL: Record<string, string> = {
  draft: 'Черновик',
  confirmed: 'Подтверждён',
  in_delivery: 'В доставке',
  delivered: 'Доставлен',
  closed: 'Закрыт',
  cancelled: 'Отменён',
}

const DELIVERY_STATUS_LABELS_LOCAL: Record<string, string> = {
  shipped: 'Отгружена',
  delivered: 'Доставлена',
  accepted: 'Принята',
  partially_accepted: 'Частично принята',
  rejected: 'Отклонена',
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ts
  }
}

function formatProjectDate(p: ProjectRow): string {
  if (p.start_date) {
    return formatTimestamp(p.start_date)
  }
  return ''
}

function parseDisplayDate(display: string): number {
  try {
    const d = new Date(display)
    return isNaN(d.getTime()) ? 0 : d.getTime()
  } catch {
    return 0
  }
}
