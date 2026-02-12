'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { type ColumnDef, DataTable, PageHeader } from '@/shared/components'
import {
  useEstimates,
  EstimateStatusBadge,
  type EstimateWithRelations,
  type EstimateStatus,
} from '@/entities/estimate'
import { cn } from '@/shared/lib/utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

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

const STATUS_OPTIONS: { label: string; value: EstimateStatus | '' }[] = [
  { label: 'Все', value: '' },
  { label: 'Черновик', value: 'draft' },
  { label: 'На проверке', value: 'review' },
  { label: 'Утверждена', value: 'approved' },
  { label: 'Архив', value: 'archived' },
]

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const columns: ColumnDef<EstimateWithRelations, unknown>[] = [
  {
    accessorKey: 'id',
    header: 'Номер',
    cell: ({ row }) => (
      <span className="font-medium text-foreground">
        {row.original.work_type ?? `Смета #${row.original.id.slice(0, 8)}`}
      </span>
    ),
  },
  {
    accessorKey: 'contractor',
    header: 'Подрядчик',
    cell: ({ row }) => (
      <span className="text-sm text-foreground">
        {row.original.contractor?.name ?? '\u2014'}
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Статус',
    cell: ({ row }) => <EstimateStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: 'total_amount',
    header: 'Сумма',
    cell: ({ row }) => (
      <span className="text-sm font-medium text-foreground text-right block">
        {formatCurrency(row.original.total_amount)}
      </span>
    ),
  },
  {
    accessorKey: 'created_at',
    header: 'Дата создания',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {formatDate(row.original.created_at)}
      </span>
    ),
  },
]

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function EstimateListWidget() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const projectId = params.id

  const [statusFilter, setStatusFilter] = useState<EstimateStatus | ''>('')
  const [search, setSearch] = useState('')

  const queryParams = useMemo(
    () => ({
      status: statusFilter || undefined,
    }),
    [statusFilter]
  )

  const { data, isLoading } = useEstimates(projectId, queryParams)

  const estimates = useMemo(() => {
    const items = data?.data ?? []
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter(
      (e) =>
        e.contractor?.name?.toLowerCase().includes(q) ||
        e.work_type?.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q)
    )
  }, [data, search])

  const handleRowClick = useCallback(
    (row: EstimateWithRelations) => {
      router.push(`/projects/${projectId}/estimates/${row.id}`)
    },
    [router, projectId]
  )

  const handleCreate = useCallback(() => {
    router.push(`/projects/${projectId}/estimates/new`)
  }, [router, projectId])

  // Toolbar: status filter
  const toolbar = (
    <div className="flex items-center gap-2">
      {STATUS_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setStatusFilter(opt.value as EstimateStatus | '')}
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
        title="Сметы"
        description="Список смет проекта"
        breadcrumbs={[
          { label: 'Проекты', href: '/projects' },
          { label: 'Проект', href: `/projects/${projectId}` },
          { label: 'Сметы' },
        ]}
        actions={
          <button
            type="button"
            onClick={handleCreate}
            className={cn(
              'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
              'hover:bg-primary/90'
            )}
          >
            <Plus className="h-4 w-4" />
            Создать смету
          </button>
        }
      />

      <DataTable<EstimateWithRelations>
        columns={columns}
        data={estimates}
        isLoading={isLoading}
        onSearch={setSearch}
        searchPlaceholder="Поиск по подрядчику..."
        toolbar={toolbar}
      />
    </div>
  )
}
