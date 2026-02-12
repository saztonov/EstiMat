'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Loader2, ArrowLeft, CheckCircle } from 'lucide-react'
import { PageHeader, ApprovalFlow } from '@/shared/components'
import {
  usePurchaseOrderDetail,
  OrderStatusBadge,
  PO_STATUS_LABELS,
} from '@/entities/purchase-order'
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
// Widget
// ---------------------------------------------------------------------------

export function OrderDetailWidget() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const orderId = params.id

  const {
    order,
    items,
    isLoading,
    confirmOrder,
    updateStatus,
    isMutating,
  } = usePurchaseOrderDetail(orderId)

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)

  const computedTotal = useMemo(
    () =>
      items.reduce(
        (sum, item) => sum + (item.quantity ?? 0) * (item.unit_price ?? 0),
        0
      ),
    [items]
  )

  const handleConfirmOrder = useCallback(async () => {
    if (!orderId) return
    await confirmOrder(orderId)
    setConfirmDialogOpen(false)
  }, [confirmOrder, orderId])

  // Build status history steps
  const statusSteps = useMemo(() => {
    if (!order) return []
    const steps = []

    steps.push({
      label: 'Создание заказа',
      status: 'approved' as const,
      date: formatDate(order.created_at),
    })

    if (order.status === 'draft') {
      steps.push({ label: 'Подтверждение', status: 'pending' as const })
    } else if (order.status === 'confirmed') {
      steps.push({
        label: 'Подтверждён',
        status: 'approved' as const,
        date: formatDate(order.confirmed_at),
      })
      steps.push({ label: 'Доставка', status: 'pending' as const })
    } else if (order.status === 'in_delivery') {
      steps.push({ label: 'Подтверждён', status: 'approved' as const })
      steps.push({ label: 'В доставке', status: 'current' as const })
    } else if (order.status === 'delivered') {
      steps.push({ label: 'Подтверждён', status: 'approved' as const })
      steps.push({
        label: 'Доставлен',
        status: 'approved' as const,
        date: formatDate(order.delivery_date),
      })
    } else if (order.status === 'closed') {
      steps.push({ label: 'Подтверждён', status: 'approved' as const })
      steps.push({ label: 'Доставлен', status: 'approved' as const })
      steps.push({ label: 'Закрыт', status: 'approved' as const })
    } else if (order.status === 'cancelled') {
      steps.push({ label: 'Отменён', status: 'rejected' as const })
    }

    return steps
  }, [order])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Загрузка заказа...</span>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-foreground">Заказ не найден</p>
      </div>
    )
  }

  const canConfirm = order.status === 'draft'

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Заказ #${order.id.slice(0, 8).toUpperCase()}`}
        breadcrumbs={[
          { label: 'Заказы', href: '/purchase-orders' },
          { label: `#${order.id.slice(0, 8).toUpperCase()}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/purchase-orders')}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
              К списку
            </button>
            {canConfirm && (
              <button
                type="button"
                onClick={() => setConfirmDialogOpen(true)}
                disabled={isMutating}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-4 text-sm font-medium text-white shadow transition-colors',
                  'hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {isMutating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                Подтвердить заказ
              </button>
            )}
          </div>
        }
      />

      {/* Order info header */}
      <div className="rounded-lg border border-border p-6">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Номер</p>
            <p className="text-sm font-medium text-foreground">
              #{order.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Поставщик</p>
            <p className="text-sm font-medium text-foreground">
              {order.supplier?.name ?? '\u2014'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Статус</p>
            <div className="mt-1">
              <OrderStatusBadge status={order.status} size="md" />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Общая сумма</p>
            <p className="text-sm font-bold text-foreground">
              {formatCurrency(computedTotal || order.total)}
            </p>
          </div>
        </div>

        {/* Additional info */}
        <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-4 border-t border-border pt-4">
          <div>
            <p className="text-xs text-muted-foreground">Контракт</p>
            <p className="text-sm font-medium text-foreground">
              {order.contract_id ? `#${order.contract_id.slice(0, 8)}` : '\u2014'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Ожидаемая поставка</p>
            <p className="text-sm font-medium text-foreground">
              {formatDate(order.delivery_date)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Дата создания</p>
            <p className="text-sm text-muted-foreground">
              {formatDate(order.created_at)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Позиций</p>
            <p className="text-sm font-medium text-foreground">
              {items.length}
            </p>
          </div>
        </div>
      </div>

      {/* Items table */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-foreground">
          Позиции заказа
        </h3>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                  Материал
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                  Ед.
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                  Кол-во
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                  Цена за ед.
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                  Итого
                </th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Нет позиций
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const rowTotal = (item.quantity ?? 0) * (item.unit_price ?? 0)
                  return (
                    <tr
                      key={item.id}
                      className="border-b border-border transition-colors hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 text-foreground">
                        {item.material?.name ?? '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {item.unit ?? item.material?.unit ?? '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {new Intl.NumberFormat('ru-RU').format(item.quantity ?? 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {formatCurrency(item.unit_price)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">
                        {formatCurrency(rowTotal)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr className="bg-muted/30">
                  <td
                    colSpan={4}
                    className="px-4 py-3 text-right text-sm font-semibold text-foreground"
                  >
                    Итого:
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-foreground">
                    {formatCurrency(computedTotal)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Status history */}
      {statusSteps.length > 0 && (
        <div>
          <h3 className="mb-4 text-lg font-semibold text-foreground">
            История статусов
          </h3>
          <div className="rounded-lg border border-border p-6">
            <ApprovalFlow steps={statusSteps} />
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
            <h4 className="text-lg font-semibold text-foreground">
              Подтвердить заказ
            </h4>
            <p className="mt-2 text-sm text-muted-foreground">
              Вы уверены, что хотите подтвердить заказ #{order.id.slice(0, 8).toUpperCase()}?
              Заказ будет отправлен поставщику.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDialogOpen(false)}
                className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmOrder}
                disabled={isMutating}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-4 text-sm font-medium text-white shadow transition-colors',
                  'hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {isMutating && <Loader2 className="h-4 w-4 animate-spin" />}
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
