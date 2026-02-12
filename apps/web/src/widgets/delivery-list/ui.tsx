'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Package, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { DataTable, type ColumnDef } from '@/shared/components'
import { PageHeader } from '@/shared/components'
import { useDeliveryList, DeliveryStatusBadge, DELIVERY_STATUS_LABELS } from '@/entities/delivery'
import { ProjectSelect } from '@/entities/project'
import type { DeliveryWithRelations } from '@estimat/shared'
import type { DeliveryStatus } from '@estimat/shared'
import { useDebounce } from '@/shared/hooks'

const DELIVERY_STATUSES: DeliveryStatus[] = [
  'shipped',
  'delivered',
  'accepted',
  'partially_accepted',
  'rejected',
]

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014'
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function DeliveryListWidget() {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | ''>('')
  const [projectFilter, setProjectFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  const params = useMemo(
    () => ({
      status: statusFilter || undefined,
      project_id: projectFilter || undefined,
      search: debouncedSearch || undefined,
    }),
    [statusFilter, projectFilter, debouncedSearch]
  )

  const { deliveries, total, isLoading } = useDeliveryList(params)

  const handleRowClick = useCallback(
    (delivery: DeliveryWithRelations) => {
      router.push(`/deliveries/${delivery.id}`)
    },
    [router]
  )

  const columns = useMemo<ColumnDef<DeliveryWithRelations, unknown>[]>(
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
        id: 'po_ref',
        header: 'Заказ (PO)',
        accessorFn: (row) =>
          row.order?.id ? row.order.id.slice(0, 8).toUpperCase() : '\u2014',
        size: 120,
      },
      {
        id: 'supplier',
        header: 'Поставщик',
        accessorFn: (row) =>
          row.supplier?.name ??
          (row as unknown as Record<string, unknown>).supplier_name ??
          '\u2014',
        size: 200,
      },
      {
        id: 'status',
        header: 'Статус',
        accessorKey: 'status',
        cell: ({ row }) => (
          <DeliveryStatusBadge status={row.original.status} />
        ),
        size: 160,
      },
      {
        id: 'date',
        header: 'Дата',
        accessorFn: (row) => row.actual_date ?? row.expected_date,
        cell: ({ getValue }) => formatDate(getValue() as string | null),
        size: 120,
      },
      {
        id: 'items_count',
        header: 'Позиций',
        accessorFn: (row) => row.items_count ?? 0,
        cell: ({ getValue }) => (
          <span className="text-center block">{getValue() as number}</span>
        ),
        size: 90,
      },
    ],
    []
  )

  const toolbar = (
    <div className="flex items-center gap-3">
      {/* Status filter */}
      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as DeliveryStatus | '')}
        className={cn(
          'h-9 rounded-md border border-input bg-transparent px-3 text-sm',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
        )}
      >
        <option value="">Все статусы</option>
        {DELIVERY_STATUSES.map((s) => (
          <option key={s} value={s}>
            {DELIVERY_STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      {/* Project filter */}
      <ProjectSelect
        value={projectFilter}
        onChange={setProjectFilter}
        placeholder="Все проекты"
        className="w-56"
      />
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Поставки"
        description={`Всего: ${total} поставок`}
        breadcrumbs={[
          { label: 'Главная', href: '/' },
          { label: 'Поставки' },
        ]}
      />

      <DataTable
        columns={columns}
        data={deliveries}
        isLoading={isLoading}
        onSearch={setSearch}
        searchPlaceholder="Поиск поставок..."
        toolbar={toolbar}
      />
    </div>
  )
}
