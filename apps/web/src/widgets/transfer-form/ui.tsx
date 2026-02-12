'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRightLeft,
  Loader2,
  AlertTriangle,
  Check,
  Minus,
  Plus,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components'
import { useDeliveryDetail } from '@/entities/delivery'
import { OrgSelect } from '@/entities/organization'
import type { DeliveryItemWithRelations } from '@estimat/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransferLineState {
  itemId: string
  selected: boolean
  quantity: string
}

interface TransferFormWidgetProps {
  deliveryId: string
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TransferItemRow({
  item,
  state,
  onChange,
}: {
  item: DeliveryItemWithRelations
  state: TransferLineState
  onChange: (update: Partial<TransferLineState>) => void
}) {
  const materialName =
    item.material_name ??
    item.material?.name ??
    item.id.slice(0, 8)

  const maxQty = item.actual_quantity ?? item.expected_quantity ?? 0

  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-lg border p-4 transition-colors',
        state.selected
          ? 'border-primary bg-primary/5'
          : 'border-border bg-card'
      )}
    >
      {/* Checkbox */}
      <label className="flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={state.selected}
          onChange={(e) => onChange({ selected: e.target.checked })}
          className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
        />
      </label>

      {/* Material info */}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground text-sm">{materialName as string}</p>
        <p className="text-xs text-muted-foreground">
          Доступно: {maxQty}
        </p>
      </div>

      {/* Quantity input */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            const current = parseFloat(state.quantity) || 0
            if (current > 0) {
              onChange({ quantity: String(current - 1), selected: true })
            }
          }}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-md border border-input text-sm transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'disabled:pointer-events-none disabled:opacity-50'
          )}
          disabled={!state.selected}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={maxQty}
          step="any"
          value={state.quantity}
          onChange={(e) =>
            onChange({ quantity: e.target.value, selected: !!e.target.value })
          }
          disabled={!state.selected}
          className={cn(
            'h-8 w-20 rounded-md border border-input bg-transparent px-2 text-center text-sm tabular-nums',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:opacity-50'
          )}
        />
        <button
          type="button"
          onClick={() => {
            const current = parseFloat(state.quantity) || 0
            if (current < maxQty) {
              onChange({ quantity: String(current + 1), selected: true })
            }
          }}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-md border border-input text-sm transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'disabled:pointer-events-none disabled:opacity-50'
          )}
          disabled={!state.selected}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Widget
// ---------------------------------------------------------------------------

export function TransferFormWidget({ deliveryId }: TransferFormWidgetProps) {
  const router = useRouter()
  const {
    delivery,
    items,
    isLoading,
    isError,
    error,
    createTransfer,
    isMutating,
  } = useDeliveryDetail(deliveryId)

  const [receiverOrgId, setReceiverOrgId] = useState('')
  const [receiverName, setReceiverName] = useState('')
  const [note, setNote] = useState('')
  const [lineStates, setLineStates] = useState<Map<string, TransferLineState>>(
    new Map()
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  const getLineState = useCallback(
    (itemId: string): TransferLineState =>
      lineStates.get(itemId) ?? {
        itemId,
        selected: false,
        quantity: '',
      },
    [lineStates]
  )

  const updateLineState = useCallback(
    (itemId: string, update: Partial<TransferLineState>) => {
      setLineStates((prev) => {
        const next = new Map(prev)
        const current = next.get(itemId) ?? {
          itemId,
          selected: false,
          quantity: '',
        }
        next.set(itemId, { ...current, ...update })
        return next
      })
    },
    []
  )

  const selectedItems = useMemo(
    () =>
      items.filter((item) => {
        const state = lineStates.get(item.id)
        return state?.selected && parseFloat(state.quantity) > 0
      }),
    [items, lineStates]
  )

  const canSubmit = selectedItems.length > 0 && receiverOrgId.length > 0

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !delivery) return
    setIsSubmitting(true)
    try {
      const transferItems = selectedItems.map((item) => {
        const state = getLineState(item.id)
        return {
          delivery_item_id: item.id,
          quantity: parseFloat(state.quantity),
        }
      })

      await createTransfer({
        deliveryId,
        data: {
          receiver_org_id: receiverOrgId,
          receiver_name: receiverName || undefined,
          note: note || undefined,
          items: transferItems,
        } as never,
      })

      router.push(`/deliveries/${deliveryId}`)
    } catch {
      // Error handled by mutation
    } finally {
      setIsSubmitting(false)
    }
  }, [
    canSubmit,
    delivery,
    selectedItems,
    getLineState,
    createTransfer,
    deliveryId,
    receiverOrgId,
    receiverName,
    note,
    router,
  ])

  // ---- Loading / Error -------------------------------------------------------
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Загрузка...</span>
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
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Передача материалов (М-15)"
        description={`Поставка ${delivery.id.slice(0, 8).toUpperCase()}`}
        breadcrumbs={[
          { label: 'Поставки', href: '/deliveries' },
          {
            label: delivery.id.slice(0, 8).toUpperCase(),
            href: `/deliveries/${deliveryId}`,
          },
          { label: 'Передача' },
        ]}
        actions={
          <Link
            href={`/deliveries/${deliveryId}`}
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

      {/* Receiver organization */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-base font-semibold text-foreground">
          Получатель
        </h2>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Организация-получатель *
          </label>
          <OrgSelect
            value={receiverOrgId}
            onChange={setReceiverOrgId}
            placeholder="Выберите организацию"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            ФИО получателя
          </label>
          <input
            type="text"
            value={receiverName}
            onChange={(e) => setReceiverName(e.target.value)}
            placeholder="Иванов И.И."
            className={cn(
              'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
              'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
            )}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Примечание
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Основание передачи..."
            className={cn(
              'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors',
              'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'resize-none'
            )}
          />
        </div>
      </div>

      {/* Select items */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            Выберите позиции для передачи
          </h2>
          <span className="text-sm text-muted-foreground">
            Выбрано: {selectedItems.length} из {items.length}
          </span>
        </div>

        {items.map((item) => (
          <TransferItemRow
            key={item.id}
            item={item}
            state={getLineState(item.id)}
            onChange={(update) => updateLineState(item.id, update)}
          />
        ))}
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting || isMutating}
          className={cn(
            'inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors',
            'hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
            'disabled:pointer-events-none disabled:opacity-50'
          )}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Создание...
            </>
          ) : (
            <>
              <ArrowRightLeft className="h-4 w-4" />
              Создать передачу
            </>
          )}
        </button>

        <Link
          href={`/deliveries/${deliveryId}`}
          className={cn(
            'inline-flex items-center justify-center rounded-md border border-input px-6 py-2.5 text-sm font-medium transition-colors',
            'hover:bg-accent hover:text-accent-foreground'
          )}
        >
          Отмена
        </Link>
      </div>
    </div>
  )
}
