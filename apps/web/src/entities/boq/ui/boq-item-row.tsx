'use client'

import { useState, useCallback } from 'react'
import { Pencil, Check, X, Trash2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { BoqItemWithRelations } from '../types'

interface BoqItemRowProps {
  item: BoqItemWithRelations
  isEditable?: boolean
  onSave?: (data: {
    id: string
    work_type?: string | null
    material_quantity?: number | null
    unit?: string
    unit_price?: number | null
    section?: string | null
  }) => void
  onDelete?: (id: string) => void
  className?: string
}

function formatNumber(value: number | null): string {
  if (value === null || value === undefined) return '\u2014'
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return '\u2014'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'KZT',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

export function BoqItemRow({
  item,
  isEditable = false,
  onSave,
  onDelete,
  className,
}: BoqItemRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editData, setEditData] = useState({
    section: item.section ?? '',
    work_type: item.work_type ?? '',
    material_quantity: item.material_quantity,
    unit: item.unit,
    unit_price: item.unit_price,
  })

  const handleStartEdit = useCallback(() => {
    setEditData({
      section: item.section ?? '',
      work_type: item.work_type ?? '',
      material_quantity: item.material_quantity,
      unit: item.unit,
      unit_price: item.unit_price,
    })
    setIsEditing(true)
  }, [item])

  const handleCancel = useCallback(() => {
    setIsEditing(false)
  }, [])

  const handleSave = useCallback(() => {
    onSave?.({
      id: item.id,
      work_type: editData.work_type || null,
      material_quantity: editData.material_quantity,
      unit: editData.unit,
      unit_price: editData.unit_price,
      section: editData.section || null,
    })
    setIsEditing(false)
  }, [item.id, editData, onSave])

  const inputClassName = cn(
    'h-7 w-full rounded border border-input bg-transparent px-2 text-sm',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
  )

  if (isEditing) {
    return (
      <tr className={cn('border-b border-border bg-muted/30', className)}>
        {/* Раздел */}
        <td className="px-4 py-2">
          <input
            type="text"
            value={editData.section}
            onChange={(e) => setEditData((prev) => ({ ...prev, section: e.target.value }))}
            className={inputClassName}
            placeholder="Раздел"
          />
        </td>

        {/* Наименование работ */}
        <td className="px-4 py-2">
          <input
            type="text"
            value={editData.work_type}
            onChange={(e) => setEditData((prev) => ({ ...prev, work_type: e.target.value }))}
            className={inputClassName}
            placeholder="Вид работ"
          />
        </td>

        {/* Материал (не редактируется inline, показываем readonly) */}
        <td className="px-4 py-2 text-sm text-muted-foreground">
          {item.material?.name ?? '\u2014'}
        </td>

        {/* Единица измерения */}
        <td className="px-4 py-2">
          <input
            type="text"
            value={editData.unit}
            onChange={(e) => setEditData((prev) => ({ ...prev, unit: e.target.value }))}
            className={cn(inputClassName, 'w-20')}
            placeholder="Ед."
          />
        </td>

        {/* Количество */}
        <td className="px-4 py-2">
          <input
            type="number"
            value={editData.material_quantity ?? ''}
            onChange={(e) =>
              setEditData((prev) => ({
                ...prev,
                material_quantity: e.target.value ? Number(e.target.value) : null,
              }))
            }
            className={cn(inputClassName, 'w-24')}
            placeholder="0"
            step="any"
          />
        </td>

        {/* Цена за единицу */}
        <td className="px-4 py-2">
          <input
            type="number"
            value={editData.unit_price ?? ''}
            onChange={(e) =>
              setEditData((prev) => ({
                ...prev,
                unit_price: e.target.value ? Number(e.target.value) : null,
              }))
            }
            className={cn(inputClassName, 'w-28')}
            placeholder="0"
            step="any"
          />
        </td>

        {/* Итого (вычисляемое) */}
        <td className="px-4 py-2 text-sm text-right font-medium">
          {formatCurrency(
            editData.material_quantity && editData.unit_price
              ? editData.material_quantity * editData.unit_price
              : null
          )}
        </td>

        {/* Действия */}
        <td className="px-4 py-2">
          <div className="flex items-center gap-1">
            <button
              onClick={handleSave}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30"
              aria-label="Сохранить"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              onClick={handleCancel}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
              aria-label="Отменить"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/50',
        className
      )}
    >
      {/* Раздел */}
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {item.section ?? '\u2014'}
      </td>

      {/* Наименование работ */}
      <td className="px-4 py-3 text-sm text-foreground">
        {item.work_type ?? '\u2014'}
      </td>

      {/* Материал */}
      <td className="px-4 py-3 text-sm text-foreground">
        {item.material?.name ?? '\u2014'}
      </td>

      {/* Единица измерения */}
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {item.unit}
      </td>

      {/* Количество */}
      <td className="px-4 py-3 text-sm text-right">
        {formatNumber(item.material_quantity)}
      </td>

      {/* Цена за единицу */}
      <td className="px-4 py-3 text-sm text-right">
        {formatCurrency(item.unit_price)}
      </td>

      {/* Итого */}
      <td className="px-4 py-3 text-sm text-right font-medium">
        {formatCurrency(item.total)}
      </td>

      {/* Действия */}
      <td className="px-4 py-3">
        {isEditable && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleStartEdit}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Редактировать"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {onDelete && (
              <button
                onClick={() => onDelete(item.id)}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
                aria-label="Удалить"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}
