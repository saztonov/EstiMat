'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { type ColumnDef, DataTable, PageHeader } from '@/shared/components'
import {
  usePurchaseOrderList,
  OrderStatusBadge,
  PO_STATUS_LABELS,
  type PurchaseOrderFilters,
} from '@/entities/purchase-order'
import type { PurchaseOrderWithRelations, PoStatus } from '@estimat/shared'
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

const STATUS_OPTIONS: { label: string; value: PoStatus | '' }[] = [
  { label: 'Все', value: '' },
  { label: 'Черновик', value: 'draft' },
  { label: 'Подтверждён', value: 'confirmed' },
  { label: 'В доставке', value: 'in_delivery' },
  { label: 'Доставлен', value: 'delivered' },
  { label: 'Закрыт', value: 'closed' },
  { label: 'Отменён', value: 'cancelled' },
]

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const columns: ColumnDef<PurchaseOrderWithRelations, unknown>[] = [
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
    accessorKey: 'supplier',
    header: 'Поставщик',
    cell: ({ row }) => (
      <span className="text-sm text-foreground">
        {row.original.supplier?.name ?? '\u2014'}
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Статус',
    cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: 'total',
    header: 'Сумма',
    cell: ({ row }) => (
      <span className="text-sm font-medium text-foreground text-right block">
        {formatCurrency(row.original.total)}
      </span>
    ),
  },
  {
    accessorKey: 'delivery_date',
    header: 'Ожидаемая поставка',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {formatDate(row.original.delivery_date)}
      </span>
    ),
  },
]

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function OrderListWidget() {
  const router = useRouter()

  const [statusFilter, setStatusFilter] = useState<PoStatus | ''>('')

  const params: PurchaseOrderFilters = useMemo(
    () => ({
      status: statusFilter || undefined,
    }),
    [statusFilter]
  )

  const { orders, isLoading } = usePurchaseOrderList(params)

  const handleRowClick = useCallback(
    (order: PurchaseOrderWithRelations) => {
      router.push(`/purchase-orders/${order.id}`)
    },
    [router]
  )

  // Toolbar: status filter
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {STATUS_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setStatusFilter(opt.value as PoStatus | '')}
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
        title="Заказы на закупку"
        description="Управление заказами поставщикам"
        breadcrumbs={[{ label: 'Заказы' }]}
      />

      <DataTable<PurchaseOrderWithRelations>
        columns={columns}
        data={orders}
        isLoading={isLoading}
        toolbar={toolbar}
      />
    </div>
  )
}
