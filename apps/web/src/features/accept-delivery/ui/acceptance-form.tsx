'use client'

import { useCallback, useState, type FormEvent } from 'react'
import { Loader2, PackageCheck } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useAcceptDelivery, useDeliveryItems } from '@/entities/delivery'

interface AcceptanceItemState {
  delivery_item_id: string
  material_name: string
  expected_quantity: number
  actual_quantity: number
  accepted: boolean
  unit: string
}

interface AcceptanceFormProps {
  deliveryId: string
  onSuccess?: () => void
}

export function AcceptanceForm({ deliveryId, onSuccess }: AcceptanceFormProps) {
  const { data: deliveryItems = [], isLoading: isLoadingItems } =
    useDeliveryItems(deliveryId)
  const acceptDelivery = useAcceptDelivery()

  const [items, setItems] = useState<AcceptanceItemState[]>([])
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)

  // Initialize items from deliveryItems once loaded
  if (deliveryItems.length > 0 && !initialized) {
    setItems(
      deliveryItems.map((item) => ({
        delivery_item_id: item.id,
        material_name: item.material_name ?? item.material_catalog_id ?? 'Материал',
        expected_quantity: item.quantity ?? 0,
        actual_quantity: item.quantity ?? 0,
        accepted: true,
        unit: item.unit ?? 'шт.',
      }))
    )
    setInitialized(true)
  }

  const updateItem = useCallback(
    (index: number, updates: Partial<AcceptanceItemState>) => {
      setItems((prev) => {
        const next = [...prev]
        next[index] = { ...next[index], ...updates }
        return next
      })
    },
    []
  )

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setError(null)

      const acceptedItems = items.map((item) => ({
        delivery_item_id: item.delivery_item_id,
        accepted_qty: item.accepted ? item.actual_quantity : 0,
        rejected_qty: item.accepted
          ? Math.max(0, item.expected_quantity - item.actual_quantity)
          : item.expected_quantity,
        rejection_reason: !item.accepted ? 'Отклонено при приёмке' : undefined,
      }))

      try {
        await acceptDelivery.mutateAsync({
          id: deliveryId,
          data: {
            items: acceptedItems,
          },
        })
        onSuccess?.()
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Не удалось оформить приёмку'
        )
      }
    },
    [deliveryId, items, comment, acceptDelivery, onSuccess]
  )

  if (isLoadingItems) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-3 text-sm text-muted-foreground">
          Загрузка позиций поставки...
        </span>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-8">
        <PackageCheck className="h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Нет позиций для приёмки
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Items table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">Материал</th>
              <th className="px-4 py-3 text-right">Ожидаемое кол-во</th>
              <th className="px-4 py-3 text-right">Фактическое кол-во</th>
              <th className="px-4 py-3">Ед.</th>
              <th className="px-4 py-3 text-center">Принято</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item, index) => (
              <tr
                key={item.delivery_item_id}
                className={cn(
                  'transition-colors hover:bg-muted/30',
                  !item.accepted && 'bg-red-50/50 dark:bg-red-950/20'
                )}
              >
                <td className="px-4 py-3 font-medium text-foreground">
                  {item.material_name}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {item.expected_quantity.toLocaleString('ru-RU')}
                </td>
                <td className="px-4 py-3 text-right">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={item.actual_quantity}
                    onChange={(e) =>
                      updateItem(index, {
                        actual_quantity: parseFloat(e.target.value) || 0,
                      })
                    }
                    disabled={acceptDelivery.isPending}
                    className={cn(
                      'w-28 rounded-md border border-input bg-transparent px-2 py-1 text-right text-sm tabular-nums shadow-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      item.actual_quantity !== item.expected_quantity &&
                        'border-amber-400 bg-amber-50/50 dark:bg-amber-950/20'
                    )}
                  />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{item.unit}</td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={item.accepted}
                    onChange={(e) =>
                      updateItem(index, { accepted: e.target.checked })
                    }
                    disabled={acceptDelivery.isPending}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Comment */}
      <div className="space-y-2">
        <label
          htmlFor="acceptance-comment"
          className="text-sm font-medium text-foreground"
        >
          Комментарий к приёмке
        </label>
        <textarea
          id="acceptance-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Замечания по качеству, количеству, упаковке..."
          rows={3}
          disabled={acceptDelivery.isPending}
          className={cn(
            'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors',
            'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <button
          type="submit"
          disabled={acceptDelivery.isPending}
          className={cn(
            'inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors',
            'hover:bg-primary/90',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          {acceptDelivery.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Оформить приёмку
        </button>
      </div>
    </form>
  )
}
