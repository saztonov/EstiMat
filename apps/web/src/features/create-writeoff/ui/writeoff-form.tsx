'use client'

import { useCallback, useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useCreateWriteoff, useDeliveryItems } from '@/entities/delivery'

interface WriteoffItemState {
  delivery_item_id: string
  material_name: string
  available_quantity: number
  quantity: number
  unit: string
}

const WRITEOFF_REASONS = [
  { value: 'defect', label: 'Брак / дефект' },
  { value: 'expired', label: 'Истёк срок годности' },
  { value: 'damaged', label: 'Повреждение при хранении' },
  { value: 'loss', label: 'Утеря / недостача' },
  { value: 'natural_loss', label: 'Естественная убыль' },
  { value: 'other', label: 'Прочее' },
] as const

interface WriteoffFormProps {
  deliveryId: string
  onSuccess?: () => void
  onCancel?: () => void
}

export function WriteoffForm({
  deliveryId,
  onSuccess,
  onCancel,
}: WriteoffFormProps) {
  const { data: deliveryItems = [], isLoading: isLoadingItems } =
    useDeliveryItems(deliveryId)
  const createWriteoff = useCreateWriteoff()

  const [reason, setReason] = useState('')
  const [reasonComment, setReasonComment] = useState('')
  const [items, setItems] = useState<WriteoffItemState[]>([])
  const [error, setError] = useState<string | null>(null)

  const addItem = useCallback(
    (deliveryItemId: string) => {
      const existing = items.find(
        (i) => i.delivery_item_id === deliveryItemId
      )
      if (existing) return

      const deliveryItem = deliveryItems.find((di) => di.id === deliveryItemId)
      if (!deliveryItem) return

      setItems((prev) => [
        ...prev,
        {
          delivery_item_id: deliveryItemId,
          material_name:
            deliveryItem.material_name ??
            deliveryItem.material_catalog_id ??
            'Материал',
          available_quantity: deliveryItem.quantity ?? 0,
          quantity: deliveryItem.quantity ?? 0,
          unit: deliveryItem.unit ?? 'шт.',
        },
      ])
    },
    [items, deliveryItems]
  )

  const removeItem = useCallback((deliveryItemId: string) => {
    setItems((prev) =>
      prev.filter((i) => i.delivery_item_id !== deliveryItemId)
    )
  }, [])

  const updateQuantity = useCallback(
    (deliveryItemId: string, quantity: number) => {
      setItems((prev) =>
        prev.map((i) =>
          i.delivery_item_id === deliveryItemId ? { ...i, quantity } : i
        )
      )
    },
    []
  )

  const availableItems = deliveryItems.filter(
    (di) => !items.some((i) => i.delivery_item_id === di.id)
  )

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setError(null)

      if (!reason) {
        setError('Выберите причину списания')
        return
      }

      if (items.length === 0) {
        setError('Добавьте хотя бы одну позицию для списания')
        return
      }

      const invalidItem = items.find(
        (i) => i.quantity <= 0 || i.quantity > i.available_quantity
      )
      if (invalidItem) {
        setError(
          `Некорректное количество для "${invalidItem.material_name}": должно быть от 1 до ${invalidItem.available_quantity}`
        )
        return
      }

      try {
        await createWriteoff.mutateAsync({
          deliveryId,
          data: {
            delivery_id: deliveryId,
            project_id: '',
            status: 'draft' as const,
            writeoff_date: new Date().toISOString().split('T')[0]!,
            items: items.map((i) => ({
              delivery_item_id: i.delivery_item_id,
              quantity: i.quantity,
            })),
          },
        })
        onSuccess?.()
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Не удалось оформить списание'
        )
      }
    },
    [deliveryId, reason, reasonComment, items, createWriteoff, onSuccess]
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <h3 className="text-base font-semibold text-foreground">
        Списание материалов
      </h3>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Reason */}
      <div className="space-y-2">
        <label
          htmlFor="writeoff-reason"
          className="text-sm font-medium text-foreground"
        >
          Причина списания <span className="text-destructive">*</span>
        </label>
        <select
          id="writeoff-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={createWriteoff.isPending}
          className={cn(
            'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            !reason && 'text-muted-foreground'
          )}
        >
          <option value="" disabled>
            Выберите причину
          </option>
          {WRITEOFF_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {/* Reason comment */}
      <div className="space-y-2">
        <label
          htmlFor="writeoff-comment"
          className="text-sm font-medium text-foreground"
        >
          Комментарий к причине
        </label>
        <textarea
          id="writeoff-comment"
          value={reasonComment}
          onChange={(e) => setReasonComment(e.target.value)}
          placeholder="Опишите подробности списания..."
          rows={2}
          disabled={createWriteoff.isPending}
          className={cn(
            'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors',
            'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        />
      </div>

      {/* Items */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">
            Позиции для списания
          </label>
          {availableItems.length > 0 && (
            <select
              onChange={(e) => {
                if (e.target.value) {
                  addItem(e.target.value)
                  e.target.value = ''
                }
              }}
              disabled={createWriteoff.isPending}
              className={cn(
                'h-8 rounded-md border border-input bg-transparent pl-3 pr-8 text-xs shadow-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
              defaultValue=""
            >
              <option value="" disabled>
                + Добавить позицию
              </option>
              {availableItems.map((di) => (
                <option key={di.id} value={di.id}>
                  {di.material_name ?? di.material_catalog_id ?? 'Материал'}
                </option>
              ))}
            </select>
          )}
        </div>

        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-6 text-center">
            <Plus className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-1 text-sm text-muted-foreground">
              Добавьте позиции из поставки
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {items.map((item) => (
              <div
                key={item.delivery_item_id}
                className="flex items-center gap-4 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.material_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Доступно: {item.available_quantity.toLocaleString('ru-RU')}{' '}
                    {item.unit}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={item.available_quantity}
                    step="any"
                    value={item.quantity}
                    onChange={(e) =>
                      updateQuantity(
                        item.delivery_item_id,
                        parseFloat(e.target.value) || 0
                      )
                    }
                    disabled={createWriteoff.isPending}
                    className={cn(
                      'w-24 rounded-md border border-input bg-transparent px-2 py-1 text-right text-sm tabular-nums shadow-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      'disabled:cursor-not-allowed disabled:opacity-50'
                    )}
                  />
                  <span className="text-xs text-muted-foreground">
                    {item.unit}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(item.delivery_item_id)}
                    disabled={createWriteoff.isPending}
                    className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={createWriteoff.isPending}
            className={cn(
              'inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            Отмена
          </button>
        )}
        <button
          type="submit"
          disabled={createWriteoff.isPending || items.length === 0 || !reason}
          className={cn(
            'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground shadow transition-colors',
            'hover:bg-destructive/90',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          {createWriteoff.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Оформить списание
        </button>
      </div>
    </form>
  )
}
