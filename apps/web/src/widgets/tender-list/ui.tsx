'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Layers } from 'lucide-react'
import { type ColumnDef, DataTable, PageHeader } from '@/shared/components'
import {
  useTenderList,
  TenderStatusBadge,
  TENDER_TYPE_LABELS,
  TENDER_STATUS_LABELS,
  type TenderFilters,
} from '@/entities/tender'
import type { TenderWithRelations, TenderStatus } from '@estimat/shared'
import { cn } from '@/shared/lib/utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '\u2014'
  return new Date(dateString).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Status filter options
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: { label: string; value: TenderStatus | '' }[] = [
  { label: 'Все', value: '' },
  { label: 'Черновик', value: 'draft' },
  { label: 'Опубликован', value: 'published' },
  { label: 'Сбор предложений', value: 'bidding' },
  { label: 'Оценка', value: 'evaluation' },
  { label: 'Победитель', value: 'awarded' },
  { label: 'Завершён', value: 'completed' },
  { label: 'Отменён', value: 'cancelled' },
]

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const columns: ColumnDef<TenderWithRelations, unknown>[] = [
  {
    accessorKey: 'id',
    header: 'Номер',
    cell: ({ row }) => (
      <span className="font-medium text-foreground">
        {row.original.id.slice(0, 8).toUpperCase()}
      </span>
    ),
  },
  {
    accessorKey: 'type',
    header: 'Тип',
    cell: ({ row }) => (
      <span className="text-sm text-foreground">
        {TENDER_TYPE_LABELS[row.original.type] ?? row.original.type}
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Статус',
    cell: ({ row }) => <TenderStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: 'lots_count',
    header: 'Лоты',
    cell: ({ row }) => (
      <span className="text-sm text-foreground text-center block">
        {row.original.lots_count ?? 0}
      </span>
    ),
  },
  {
    accessorKey: 'period_end',
    header: 'Дедлайн',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {formatDate(row.original.period_end)}
      </span>
    ),
  },
]

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function TenderListWidget() {
  const router = useRouter()

  const [statusFilter, setStatusFilter] = useState<TenderStatus | ''>('')
  const [showConsolidation, setShowConsolidation] = useState(false)

  const params: TenderFilters = useMemo(
    () => ({
      status: statusFilter || undefined,
    }),
    [statusFilter]
  )

  const { tenders, isLoading } = useTenderList(params)

  const handleRowClick = useCallback(
    (tender: TenderWithRelations) => {
      router.push(`/tenders/${tender.id}`)
    },
    [router]
  )

  const handleConsolidate = useCallback(() => {
    router.push('/tenders/consolidation')
  }, [router])

  // Toolbar: status filter
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {STATUS_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setStatusFilter(opt.value as TenderStatus | '')}
          className={cn(
            'inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors',
            statusFilter === opt.value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Тендеры"
        description="Управление тендерами и закупками"
        breadcrumbs={[{ label: 'Тендеры' }]}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleConsolidate}
              className={cn(
                'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input px-4 text-sm font-medium transition-colors',
                'hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Layers className="h-4 w-4" />
              Консолидировать заявки
            </button>
          </div>
        }
      />

      <DataTable<TenderWithRelations>
        columns={columns}
        data={tenders}
        isLoading={isLoading}
        toolbar={toolbar}
      />
    </div>
  )
}
