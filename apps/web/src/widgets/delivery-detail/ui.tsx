'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  CheckCircle,
  ArrowRightLeft,
  ShoppingCart,
  Trash2,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  Package,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader, DataTable, type ColumnDef } from '@/shared/components'
import {
  useDeliveryDetail,
  DeliveryStatusBadge,
  DELIVERY_STATUS_LABELS,
} from '@/entities/delivery'
import type { DeliveryItemWithRelations } from '@estimat/shared'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014'
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const ITEM_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидание',
  accepted: 'Принято',
  partially_accepted: 'Частично',
  rejected: 'Отклонено',
}

function ItemStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
    accepted: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
    partially_accepted: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
    rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        colorMap[status] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-400'
      )}
    >
      {ITEM_STATUS_LABELS[status] ?? status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DeliveryDetailWidgetProps {
  deliveryId: string
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function DeliveryDetailWidget({ deliveryId }: DeliveryDetailWidgetProps) {
  const router = useRouter()
  const {
    delivery,
    items,
    isLoading,
    isError,
    error,
    isMutating,
  } = useDeliveryDetail(deliveryId)

  // ---- Items table columns --------------------------------------------------
  const itemColumns = useMemo<ColumnDef<DeliveryItemWithRelations, unknown>[]>(
    () => [
      {
        id: 'material',
        header: 'Материал',
        accessorFn: (row) =>
          row.material_name ??
          row.material?.name ??
          row.id.slice(0, 8),
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue() as string}</span>
        ),
        size: 260,
      },
      {
        id: 'expected_qty',
        header: 'Ожид. кол-во',
        accessorKey: 'expected_quantity',
        cell: ({ getValue }) => (
          <span className="tabular-nums">
            {(getValue() as number | null) ?? '\u2014'}
          </span>
        ),
        size: 120,
      },
      {
        id: 'actual_qty',
        header: 'Факт. кол-во',
        accessorKey: 'actual_quantity',
        cell: ({ getValue }) => (
          <span className="tabular-nums">
            {(getValue() as number | null) ?? '\u2014'}
          </span>
        ),
        size: 120,
      },
      {
        id: 'status',
        header: 'Статус',
        accessorKey: 'status',
        cell: ({ getValue }) => <ItemStatusBadge status={getValue() as string} />,
        size: 140,
      },
    ],
    []
  )

  // ---- Loading / Error states -----------------------------------------------
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Загрузка поставки...</span>
      </div>
    )
  }

  if (isError || !delivery) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="mt-3 text-sm text-destructive">
          {(error as Error)?.message ?? 'Поставка не найдена'}
        </p>
        <button
          onClick={() => router.push('/deliveries')}
          className="mt-4 text-sm font-medium text-primary hover:underline"
        >
          Вернуться к списку
        </button>
      </div>
    )
  }

  // ---- Render ---------------------------------------------------------------
  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        title={`Поставка ${delivery.id.slice(0, 8).toUpperCase()}`}
        breadcrumbs={[
          { label: 'Главная', href: '/' },
          { label: 'Поставки', href: '/deliveries' },
          { label: delivery.id.slice(0, 8).toUpperCase() },
        ]}
        actions={
          <Link
            href="/deliveries"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium transition-colors',
              'hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </Link>
        }
      />

      {/* Delivery info card */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          Информация о поставке
        </h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Заказ (PO)
            </dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {delivery.order?.id
                ? delivery.order.id.slice(0, 8).toUpperCase()
                : '\u2014'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Поставщик
            </dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {delivery.supplier?.name ??
                ((delivery as unknown as Record<string, unknown>).supplier_name as string) ??
                '\u2014'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Статус
            </dt>
            <dd className="mt-1">
              <DeliveryStatusBadge status={delivery.status} size="md" />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Дата поставки
            </dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {formatDate(delivery.actual_date ?? delivery.expected_date)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Ожидаемая дата
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {formatDate(delivery.expected_date)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Фактическая дата
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {formatDate(delivery.actual_date)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Позиций
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {items.length}
            </dd>
          </div>
        </dl>
      </div>

      {/* Items table */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          Позиции поставки
        </h2>
        <DataTable columns={itemColumns} data={items} isLoading={isLoading} />
      </div>

      {/* Action buttons hub */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          Действия
        </h2>
        <div className="flex flex-wrap gap-3">
          {/* Accept */}
          <Link
            href={`/deliveries/${deliveryId}/accept`}
            className={cn(
              'inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors',
              'hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2',
              (delivery.status === 'accepted' || delivery.status === 'rejected') &&
                'pointer-events-none opacity-50'
            )}
          >
            <CheckCircle className="h-4 w-4" />
            Приёмка
          </Link>

          {/* Transfer (M-15) */}
          <Link
            href={`/deliveries/${deliveryId}/transfer`}
            className={cn(
              'inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors',
              'hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2'
            )}
          >
            <ArrowRightLeft className="h-4 w-4" />
            Передача (М-15)
          </Link>

          {/* Sale */}
          <button
            disabled={isMutating}
            className={cn(
              'inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors',
              'hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2',
              'disabled:pointer-events-none disabled:opacity-50'
            )}
          >
            <ShoppingCart className="h-4 w-4" />
            Продажа
          </button>

          {/* Write-off */}
          <button
            disabled={isMutating}
            className={cn(
              'inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors',
              'hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2',
              'disabled:pointer-events-none disabled:opacity-50'
            )}
          >
            <Trash2 className="h-4 w-4" />
            Списание
          </button>

          {/* Claim */}
          <button
            disabled={isMutating}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              'disabled:pointer-events-none disabled:opacity-50'
            )}
          >
            <AlertTriangle className="h-4 w-4" />
            Рекламация
          </button>
        </div>
      </div>
    </div>
  )
}
