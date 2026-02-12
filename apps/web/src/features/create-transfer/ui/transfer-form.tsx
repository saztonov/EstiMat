'use client'

import { useCallback, useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useCreateTransfer, useDeliveryItems } from '@/entities/delivery'
import { OrgSelect } from '@/entities/organization'

interface TransferItemState {
  delivery_item_id: string
  material_name: string
  available_quantity: number
  quantity: number
  unit: string
}

interface TransferFormProps {
  deliveryId: string
  onSuccess?: () => void
  onCancel?: () => void
}

export function TransferForm({
  deliveryId,
  onSuccess,
  onCancel,
}: TransferFormProps) {
  const { data: deliveryItems = [], isLoading: isLoadingItems } =
    useDeliveryItems(deliveryId)
  const createTransfer = useCreateTransfer()

  const [receiverOrgId, setReceiverOrgId] = useState('')
  const [items, setItems] = useState<TransferItemState[]>([])
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

      if (!receiverOrgId) {
        setError('Выберите организацию-получателя')
        return
      }

      if (items.length === 0) {
        setError('Добавьте хотя бы одну позицию для передачи')
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
        await createTransfer.mutateAsync({
          deliveryId,
          data: {
            delivery_id: deliveryId,
            contractor_id: receiverOrgId,
            type: 'davalcheskie' as const,
            status: 'draft' as const,
            doc_number: `М-15-${Date.now()}`,
            doc_date: new Date().toISOString().split('T')[0]!,
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
            : 'Не удалось создать передачу материалов (М-15)'
        )
      }
    },
    [deliveryId, receiverOrgId, items, createTransfer, onSuccess]
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
        Передача материалов (М-15)
      </h3>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Receiver organization */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Организация-получатель <span className="text-destructive">*</span>
        </label>
        <OrgSelect
          value={receiverOrgId}
          onChange={setReceiverOrgId}
          placeholder="Выберите организацию"
          disabled={createTransfer.isPending}
        />
      </div>

      {/* Items */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">
            Позиции для передачи
          </label>
          {availableItems.length > 0 && (
            <div className="relative">
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    addItem(e.target.value)
                    e.target.value = ''
                  }
                }}
                disabled={createTransfer.isPending}
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
            </div>
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
                    disabled={createTransfer.isPending}
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
                    disabled={createTransfer.isPending}
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
            disabled={createTransfer.isPending}
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
          disabled={createTransfer.isPending || items.length === 0}
          className={cn(
            'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
            'hover:bg-primary/90',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          {createTransfer.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Оформить передачу
        </button>
      </div>
    </form>
  )
}
