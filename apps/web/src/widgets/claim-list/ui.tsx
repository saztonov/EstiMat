'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/shared/lib/utils'
import { DataTable, type ColumnDef } from '@/shared/components'
import { PageHeader } from '@/shared/components'
import {
  useClaimList,
  ClaimTypeBadge,
  CLAIM_STATUS_LABELS,
  CLAIM_TYPE_LABELS,
  CLAIM_STATUS_COLORS,
} from '@/entities/claim'
import type { ClaimWithRelations, ClaimType, ClaimStatus } from '@estimat/shared'
import { useDebounce } from '@/shared/hooks'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLAIM_TYPES: ClaimType[] = ['quantity', 'quality', 'damage', 'delay', 'other']
const CLAIM_STATUSES: ClaimStatus[] = ['open', 'in_progress', 'resolved', 'closed']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAmount(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '\u2014'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

const claimStatusStyles: Record<ClaimStatus, string> = {
  open: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  resolved: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  closed: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-400',
}

function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        claimStatusStyles[status] ?? claimStatusStyles.open
      )}
    >
      {CLAIM_STATUS_LABELS[status] ?? status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function ClaimListWidget() {
  const router = useRouter()
  const [typeFilter, setTypeFilter] = useState<ClaimType | ''>('')
  const [statusFilter, setStatusFilter] = useState<ClaimStatus | ''>('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  const params = useMemo(
    () => ({
      type: typeFilter || undefined,
      status: statusFilter || undefined,
      search: debouncedSearch || undefined,
    }),
    [typeFilter, statusFilter, debouncedSearch]
  )

  const { claims, total, isLoading } = useClaimList(params)

  const columns = useMemo<ColumnDef<ClaimWithRelations, unknown>[]>(
    () => [
      {
        id: 'number',
        header: 'Номер',
        accessorFn: (row) => row.id.slice(0, 8).toUpperCase(),
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">
            {getValue() as string}
          </span>
        ),
        size: 120,
      },
      {
        id: 'type',
        header: 'Тип',
        accessorKey: 'type',
        cell: ({ row }) => <ClaimTypeBadge type={row.original.type} />,
        size: 140,
      },
      {
        id: 'delivery_ref',
        header: 'Поставка',
        accessorFn: (row) =>
          row.delivery?.id
            ? row.delivery.id.slice(0, 8).toUpperCase()
            : '\u2014',
        size: 120,
      },
      {
        id: 'status',
        header: 'Статус',
        accessorKey: 'status',
        cell: ({ row }) => <ClaimStatusBadge status={row.original.status} />,
        size: 140,
      },
      {
        id: 'amount',
        header: 'Сумма',
        accessorKey: 'amount',
        cell: ({ getValue }) => (
          <span className="tabular-nums font-medium text-right block">
            {formatAmount(getValue() as number | null)}
          </span>
        ),
        size: 140,
      },
    ],
    []
  )

  const toolbar = (
    <div className="flex items-center gap-3">
      {/* Type filter */}
      <select
        value={typeFilter}
        onChange={(e) => setTypeFilter(e.target.value as ClaimType | '')}
        className={cn(
          'h-9 rounded-md border border-input bg-transparent px-3 text-sm',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
        )}
      >
        <option value="">Все типы</option>
        {CLAIM_TYPES.map((t) => (
          <option key={t} value={t}>
            {CLAIM_TYPE_LABELS[t]}
          </option>
        ))}
      </select>

      {/* Status filter */}
      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as ClaimStatus | '')}
        className={cn(
          'h-9 rounded-md border border-input bg-transparent px-3 text-sm',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
        )}
      >
        <option value="">Все статусы</option>
        {CLAIM_STATUSES.map((s) => (
          <option key={s} value={s}>
            {CLAIM_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Рекламации"
        description={`Всего: ${total} рекламаций`}
        breadcrumbs={[
          { label: 'Главная', href: '/' },
          { label: 'Рекламации' },
        ]}
      />

      <DataTable
        columns={columns}
        data={claims}
        isLoading={isLoading}
        onSearch={setSearch}
        searchPlaceholder="Поиск рекламаций..."
        toolbar={toolbar}
      />
    </div>
  )
}
