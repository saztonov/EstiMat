'use client'

import { useCallback, useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useCreateSale, useDeliveryItems } from '@/entities/delivery'
import { OrgSelect } from '@/entities/organization'

interface SaleItemState {
  delivery_item_id: string
  material_name: string
  available_quantity: number
  quantity: number
  unit: string
  price: number
}

interface SaleFormProps {
  deliveryId: string
  onSuccess?: () => void
  onCancel?: () => void
}

export function SaleForm({ deliveryId, onSuccess, onCancel }: SaleFormProps) {
  const { data: deliveryItems = [], isLoading: isLoadingItems } =
    useDeliveryItems(deliveryId)
  const createSale = useCreateSale()

  const [buyerOrgId, setBuyerOrgId] = useState('')
  const [items, setItems] = useState<SaleItemState[]>([])
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
          price: 0,
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

  const updateItem = useCallback(
    (
      deliveryItemId: string,
      updates: Partial<Pick<SaleItemState, 'quantity' | 'price'>>
    ) => {
      setItems((prev) =>
        prev.map((i) =>
          i.delivery_item_id === deliveryItemId ? { ...i, ...updates } : i
        )
      )
    },
    []
  )

  const availableItems = deliveryItems.filter(
    (di) => !items.some((i) => i.delivery_item_id === di.id)
  )

  const totalAmount = items.reduce(
    (sum, i) => sum + i.quantity * i.price,
    0
  )

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setError(null)

      if (!buyerOrgId) {
        setError('Выберите организацию-покупателя')
        return
      }

      if (items.length === 0) {
        setError('Добавьте хотя бы одну позицию')
        return
      }

      const invalidItem = items.find(
        (i) => i.quantity <= 0 || i.quantity > i.available_quantity
      )
      if (invalidItem) {
        setError(
          `Некорректное количество для "${invalidItem.material_name}"`
        )
        return
      }

      const zeroPriceItem = items.find((i) => i.price <= 0)
      if (zeroPriceItem) {
        setError(
          `Укажите цену для "${zeroPriceItem.material_name}"`
        )
        return
      }

      try {
        await createSale.mutateAsync({
          deliveryId,
          data: {
            delivery_id: deliveryId,
            contractor_id: buyerOrgId,
            status: 'draft' as const,
            amount: totalAmount,
            items: items.map((i) => ({
              delivery_item_id: i.delivery_item_id,
              quantity: i.quantity,
              price: i.price,
            })),
          },
        })
        onSuccess?.()
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Не удалось оформить продажу материалов'
        )
      }
    },
    [deliveryId, buyerOrgId, items, createSale, onSuccess]
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
        Продажа материалов подрядчику
      </h3>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Buyer organization */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Организация-покупатель <span className="text-destructive">*</span>
        </label>
        <OrgSelect
          value={buyerOrgId}
          onChange={setBuyerOrgId}
          orgType="contractor"
          placeholder="Выберите подрядчика"
          disabled={createSale.isPending}
        />
      </div>

      {/* Items */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">
            Позиции для продажи
          </label>
          {availableItems.length > 0 && (
            <select
              onChange={(e) => {
                if (e.target.value) {
                  addItem(e.target.value)
                  e.target.value = ''
                }
              }}
              disabled={createSale.isPending}
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
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2">Материал</th>
                  <th className="px-4 py-2 text-right">Кол-во</th>
                  <th className="px-4 py-2">Ед.</th>
                  <th className="px-4 py-2 text-right">Цена за ед.</th>
                  <th className="px-4 py-2 text-right">Сумма</th>
                  <th className="px-4 py-2 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => (
                  <tr key={item.delivery_item_id} className="hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <p className="text-sm font-medium text-foreground">
                        {item.material_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Доступно: {item.available_quantity.toLocaleString('ru-RU')}
                      </p>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="number"
                        min={1}
                        max={item.available_quantity}
                        step="any"
                        value={item.quantity}
                        onChange={(e) =>
                          updateItem(item.delivery_item_id, {
                            quantity: parseFloat(e.target.value) || 0,
                          })
                        }
                        disabled={createSale.isPending}
                        className={cn(
                          'w-24 rounded-md border border-input bg-transparent px-2 py-1 text-right text-sm tabular-nums shadow-sm',
                          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                          'disabled:cursor-not-allowed disabled:opacity-50'
                        )}
                      />
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {item.unit}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.price}
                        onChange={(e) =>
                          updateItem(item.delivery_item_id, {
                            price: parseFloat(e.target.value) || 0,
                          })
                        }
                        disabled={createSale.isPending}
                        placeholder="0.00"
                        className={cn(
                          'w-28 rounded-md border border-input bg-transparent px-2 py-1 text-right text-sm tabular-nums shadow-sm',
                          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                          'disabled:cursor-not-allowed disabled:opacity-50'
                        )}
                      />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-foreground">
                      {(item.quantity * item.price).toLocaleString('ru-RU', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => removeItem(item.delivery_item_id)}
                        disabled={createSale.isPending}
                        className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/50">
                  <td
                    colSpan={4}
                    className="px-4 py-2 text-right text-sm font-semibold text-foreground"
                  >
                    Итого:
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-sm font-bold text-foreground">
                    {totalAmount.toLocaleString('ru-RU', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={createSale.isPending}
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
          disabled={createSale.isPending || items.length === 0}
          className={cn(
            'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
            'hover:bg-primary/90',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          {createSale.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Оформить продажу
        </button>
      </div>
    </form>
  )
}
