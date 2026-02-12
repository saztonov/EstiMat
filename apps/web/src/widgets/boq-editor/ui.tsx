'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components/page-header'
import {
  useBoq,
  useBoqItems,
  useCreateBoqItem,
  useUpdateBoqItem,
  useDeleteBoqItem,
  useApproveBoq,
  useUpdateBoq,
  BoqStatusBadge,
  type BoqItemWithRelations,
  type BoqStatus,
} from '@/entities/boq'
import { MaterialSelect } from '@/entities/material'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BoqEditorWidgetProps {
  projectId: string
  boqId: string
  projectName?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

// ---------------------------------------------------------------------------
// Inline edit row state
// ---------------------------------------------------------------------------

interface EditableItemState {
  section: string
  work_type: string
  material_id: string
  unit: string
  material_quantity: number | null
  unit_price: number | null
}

const emptyItemState: EditableItemState = {
  section: '',
  work_type: '',
  material_id: '',
  unit: '',
  material_quantity: null,
  unit_price: null,
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function BoqEditorWidget({ projectId, boqId, projectName }: BoqEditorWidgetProps) {
  const { data: boq, isLoading: boqLoading } = useBoq(boqId)
  const { data: items = [], isLoading: itemsLoading } = useBoqItems(boqId)

  const createItem = useCreateBoqItem()
  const updateItem = useUpdateBoqItem()
  const deleteItem = useDeleteBoqItem()
  const approveBoq = useApproveBoq()
  const updateBoq = useUpdateBoq()

  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditableItemState>(emptyItemState)
  const [newRow, setNewRow] = useState<EditableItemState | null>(null)
  const [actionDialogType, setActionDialogType] = useState<'approve' | 'reject' | null>(null)

  const isEditable = boq?.status === 'draft' || boq?.status === 'review'
  const isLoading = boqLoading || itemsLoading

  // -------------------------------------------------------------------------
  // Section totals
  // -------------------------------------------------------------------------

  const { sectionTotals, grandTotal } = useMemo(() => {
    const sections: Record<string, number> = {}
    let total = 0

    for (const item of items) {
      const itemTotal = (item.material_quantity ?? 0) * (item.unit_price ?? 0)
      const sectionKey = item.section ?? 'Без раздела'
      sections[sectionKey] = (sections[sectionKey] ?? 0) + itemTotal
      total += itemTotal
    }

    return { sectionTotals: sections, grandTotal: total }
  }, [items])

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const startEdit = useCallback((item: BoqItemWithRelations) => {
    setEditingItemId(item.id)
    setEditState({
      section: item.section ?? '',
      work_type: item.work_type ?? '',
      material_id: item.material_id ?? '',
      unit: item.unit,
      material_quantity: item.material_quantity,
      unit_price: item.unit_price,
    })
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingItemId(null)
    setEditState(emptyItemState)
  }, [])

  const saveEdit = useCallback(() => {
    if (!editingItemId) return
    updateItem.mutate(
      {
        id: editingItemId,
        boqId,
        work_type: editState.work_type || null,
        material_id: editState.material_id || null,
        material_quantity: editState.material_quantity,
        unit: editState.unit,
        unit_price: editState.unit_price,
        section: editState.section || null,
      },
      {
        onSuccess: () => {
          setEditingItemId(null)
          setEditState(emptyItemState)
        },
      }
    )
  }, [editingItemId, editState, boqId, updateItem])

  const handleDeleteItem = useCallback(
    (itemId: string) => {
      if (window.confirm('Удалить эту позицию?')) {
        deleteItem.mutate({ id: itemId, boqId })
      }
    },
    [boqId, deleteItem]
  )

  const startNewRow = useCallback(() => {
    setNewRow({ ...emptyItemState })
  }, [])

  const cancelNewRow = useCallback(() => {
    setNewRow(null)
  }, [])

  const saveNewRow = useCallback(() => {
    if (!newRow) return
    createItem.mutate(
      {
        boqId,
        section: newRow.section || null,
        work_type: newRow.work_type || null,
        material_id: newRow.material_id || null,
        unit: newRow.unit || 'шт',
        material_quantity: newRow.material_quantity,
        unit_price: newRow.unit_price,
        sort_order: items.length + 1,
      },
      {
        onSuccess: () => setNewRow(null),
      }
    )
  }, [newRow, boqId, items.length, createItem])

  const handleApproveAction = useCallback(
    (comment?: string) => {
      if (!boq) return
      if (actionDialogType === 'approve') {
        approveBoq.mutate(
          { id: boq.id, comment },
          { onSuccess: () => setActionDialogType(null) }
        )
      } else if (actionDialogType === 'reject') {
        updateBoq.mutate(
          { id: boq.id, status: 'draft' as BoqStatus, notes: comment ?? null },
          { onSuccess: () => setActionDialogType(null) }
        )
      }
    },
    [boq, actionDialogType, approveBoq, updateBoq]
  )

  // Send to review
  const sendToReview = useCallback(() => {
    if (!boq) return
    updateBoq.mutate({ id: boq.id, status: 'review' })
  }, [boq, updateBoq])

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const inputCn = cn(
    'h-7 w-full rounded border border-input bg-transparent px-2 text-sm',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Загрузка ВОР...</span>
      </div>
    )
  }

  if (!boq) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">ВОР не найден</p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={`ВОР v${boq.version}`}
        breadcrumbs={[
          { label: 'Проекты', href: '/projects' },
          { label: projectName ?? 'Проект', href: `/projects/${projectId}` },
          { label: 'ВОР', href: `/projects/${projectId}/boq` },
          { label: `v${boq.version}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <BoqStatusBadge status={boq.status} />

            {boq.status === 'draft' && (
              <button
                onClick={sendToReview}
                disabled={updateBoq.isPending}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {updateBoq.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                На проверку
              </button>
            )}

            {boq.status === 'review' && (
              <>
                <button
                  onClick={() => setActionDialogType('approve')}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-4 text-sm font-medium text-white hover:bg-green-700"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Утвердить
                </button>
                <button
                  onClick={() => setActionDialogType('reject')}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
                >
                  <XCircle className="h-4 w-4" />
                  Отклонить
                </button>
              </>
            )}
          </div>
        }
      />

      {/* Notes */}
      {boq.notes && (
        <div className="mb-4 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <strong>Примечание:</strong> {boq.notes}
        </div>
      )}

      {/* BOQ Table */}
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full caption-bottom text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-[120px]">
                Раздел
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Наименование
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-[200px]">
                Материал
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-[80px]">
                Ед.
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground w-[100px]">
                Кол-во
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground w-[120px]">
                Цена
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground w-[130px]">
                Итого
              </th>
              <th className="px-4 py-3 w-[70px]" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isCurrentlyEditing = editingItemId === item.id

              if (isCurrentlyEditing) {
                return (
                  <tr key={item.id} className="border-b border-border bg-muted/30">
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={editState.section}
                        onChange={(e) => setEditState((prev) => ({ ...prev, section: e.target.value }))}
                        className={inputCn}
                        placeholder="Раздел"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={editState.work_type}
                        onChange={(e) => setEditState((prev) => ({ ...prev, work_type: e.target.value }))}
                        className={inputCn}
                        placeholder="Вид работ"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <MaterialSelect
                        value={editState.material_id}
                        onChange={(id) => setEditState((prev) => ({ ...prev, material_id: id }))}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={editState.unit}
                        onChange={(e) => setEditState((prev) => ({ ...prev, unit: e.target.value }))}
                        className={cn(inputCn, 'w-16')}
                        placeholder="Ед."
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        value={editState.material_quantity ?? ''}
                        onChange={(e) =>
                          setEditState((prev) => ({
                            ...prev,
                            material_quantity: e.target.value ? Number(e.target.value) : null,
                          }))
                        }
                        className={cn(inputCn, 'w-20 text-right')}
                        placeholder="0"
                        step="any"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        value={editState.unit_price ?? ''}
                        onChange={(e) =>
                          setEditState((prev) => ({
                            ...prev,
                            unit_price: e.target.value ? Number(e.target.value) : null,
                          }))
                        }
                        className={cn(inputCn, 'w-24 text-right')}
                        placeholder="0"
                        step="any"
                      />
                    </td>
                    <td className="px-4 py-2 text-right text-sm font-medium">
                      {formatCurrency(
                        editState.material_quantity && editState.unit_price
                          ? editState.material_quantity * editState.unit_price
                          : null
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={saveEdit}
                          disabled={updateItem.isPending}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30"
                          aria-label="Сохранить"
                        >
                          {updateItem.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                          aria-label="Отменить"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              }

              return (
                <tr
                  key={item.id}
                  className={cn(
                    'border-b border-border transition-colors hover:bg-muted/50',
                    isEditable && 'cursor-pointer'
                  )}
                  onDoubleClick={() => isEditable && startEdit(item)}
                >
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {item.section ?? '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">
                    {item.work_type ?? '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">
                    {item.material?.name ?? '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{item.unit}</td>
                  <td className="px-4 py-3 text-sm text-right">{formatNumber(item.material_quantity)}</td>
                  <td className="px-4 py-3 text-sm text-right">{formatCurrency(item.unit_price)}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{formatCurrency(item.total)}</td>
                  <td className="px-4 py-3">
                    {isEditable && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            startEdit(item)
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label="Редактировать"
                        >
                          <Save className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteItem(item.id)
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
                          aria-label="Удалить"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}

            {/* New row */}
            {newRow && (
              <tr className="border-b border-border bg-primary/5">
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={newRow.section}
                    onChange={(e) => setNewRow((prev) => prev && ({ ...prev, section: e.target.value }))}
                    className={inputCn}
                    placeholder="Раздел"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={newRow.work_type}
                    onChange={(e) => setNewRow((prev) => prev && ({ ...prev, work_type: e.target.value }))}
                    className={inputCn}
                    placeholder="Вид работ"
                  />
                </td>
                <td className="px-4 py-2">
                  <MaterialSelect
                    value={newRow.material_id}
                    onChange={(id) => setNewRow((prev) => prev && ({ ...prev, material_id: id }))}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={newRow.unit}
                    onChange={(e) => setNewRow((prev) => prev && ({ ...prev, unit: e.target.value }))}
                    className={cn(inputCn, 'w-16')}
                    placeholder="шт"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    value={newRow.material_quantity ?? ''}
                    onChange={(e) =>
                      setNewRow((prev) =>
                        prev && ({
                          ...prev,
                          material_quantity: e.target.value ? Number(e.target.value) : null,
                        })
                      )
                    }
                    className={cn(inputCn, 'w-20 text-right')}
                    placeholder="0"
                    step="any"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    value={newRow.unit_price ?? ''}
                    onChange={(e) =>
                      setNewRow((prev) =>
                        prev && ({
                          ...prev,
                          unit_price: e.target.value ? Number(e.target.value) : null,
                        })
                      )
                    }
                    className={cn(inputCn, 'w-24 text-right')}
                    placeholder="0"
                    step="any"
                  />
                </td>
                <td className="px-4 py-2 text-right text-sm font-medium">
                  {formatCurrency(
                    newRow.material_quantity && newRow.unit_price
                      ? newRow.material_quantity * newRow.unit_price
                      : null
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={saveNewRow}
                      disabled={createItem.isPending}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30"
                      aria-label="Сохранить"
                    >
                      {createItem.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={cancelNewRow}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                      aria-label="Отменить"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {/* Empty state */}
            {items.length === 0 && !newRow && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Нет позиций. Добавьте первую позицию ВОР.
                </td>
              </tr>
            )}
          </tbody>

          {/* Footer with totals */}
          <tfoot className="border-t-2 border-border bg-muted/50">
            {/* Section subtotals */}
            {Object.entries(sectionTotals).map(([section, total]) => (
              <tr key={section} className="border-b border-border">
                <td colSpan={6} className="px-4 py-2 text-sm font-medium text-muted-foreground text-right">
                  Итого по разделу "{section}":
                </td>
                <td className="px-4 py-2 text-sm text-right font-semibold text-foreground">
                  {formatCurrency(total)}
                </td>
                <td />
              </tr>
            ))}

            {/* Grand total */}
            <tr>
              <td colSpan={6} className="px-4 py-3 text-sm font-bold text-foreground text-right">
                ИТОГО:
              </td>
              <td className="px-4 py-3 text-sm text-right font-bold text-foreground">
                {formatCurrency(grandTotal)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Add item button */}
      {isEditable && !newRow && (
        <div className="mt-4">
          <button
            onClick={startNewRow}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-dashed border-border px-4 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Plus className="h-4 w-4" />
            Добавить позицию
          </button>
        </div>
      )}

      {/* Action Dialog */}
      {actionDialogType && (
        <BoqActionDialog
          type={actionDialogType}
          isPending={approveBoq.isPending || updateBoq.isPending}
          onClose={() => setActionDialogType(null)}
          onConfirm={handleApproveAction}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BoqActionDialog
// ---------------------------------------------------------------------------

function BoqActionDialog({
  type,
  isPending,
  onClose,
  onConfirm,
}: {
  type: 'approve' | 'reject'
  isPending: boolean
  onClose: () => void
  onConfirm: (comment?: string) => void
}) {
  const [comment, setComment] = useState('')

  const title = type === 'approve' ? 'Утвердить ВОР' : 'Отклонить ВОР'
  const description =
    type === 'approve'
      ? 'Подтвердите утверждение ведомости объемов работ.'
      : 'Укажите причину отклонения. ВОР будет возвращен в статус черновика.'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">
            Комментарий {type === 'reject' ? '*' : '(необязательно)'}
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className={cn(
              'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[80px]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'placeholder:text-muted-foreground'
            )}
            placeholder={type === 'reject' ? 'Укажите причину...' : 'Комментарий...'}
          />
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted"
          >
            Отмена
          </button>
          <button
            onClick={() => onConfirm(comment || undefined)}
            disabled={isPending || (type === 'reject' && !comment.trim())}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium text-white disabled:opacity-50',
              type === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
            )}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {type === 'approve' ? 'Утвердить' : 'Отклонить'}
          </button>
        </div>
      </div>
    </div>
  )
}
