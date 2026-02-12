'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  ClipboardList,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components/page-header'
import {
  useBoq,
  useBoqItems,
  useApproveBoq,
  useUpdateBoq,
  BoqStatusBadge,
  type BoqItemWithRelations,
  type BoqStatus,
} from '@/entities/boq'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BoqVerifyWidgetProps {
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
// Widget
// ---------------------------------------------------------------------------

export function BoqVerifyWidget({ projectId, boqId, projectName }: BoqVerifyWidgetProps) {
  const { data: boq, isLoading: boqLoading } = useBoq(boqId)
  const { data: items = [], isLoading: itemsLoading } = useBoqItems(boqId)

  const approveBoq = useApproveBoq()
  const updateBoq = useUpdateBoq()

  const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null)

  const isLoading = boqLoading || itemsLoading

  // -------------------------------------------------------------------------
  // Totals
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

  const handleAction = useCallback(
    (comment?: string) => {
      if (!boq) return

      if (actionType === 'approve') {
        approveBoq.mutate(
          { id: boq.id, comment },
          { onSuccess: () => setActionType(null) }
        )
      } else if (actionType === 'reject') {
        updateBoq.mutate(
          { id: boq.id, status: 'draft' as BoqStatus, notes: comment ?? null },
          { onSuccess: () => setActionType(null) }
        )
      }
    },
    [boq, actionType, approveBoq, updateBoq]
  )

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

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

  const canVerify = boq.status === 'review'

  return (
    <div>
      <PageHeader
        title={`Проверка ВОР v${boq.version}`}
        breadcrumbs={[
          { label: 'Проекты', href: '/projects' },
          { label: projectName ?? 'Проект', href: `/projects/${projectId}` },
          { label: 'ВОР', href: `/projects/${projectId}/boq` },
          { label: `Проверка v${boq.version}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <BoqStatusBadge status={boq.status} />

            {canVerify && (
              <>
                <button
                  onClick={() => setActionType('approve')}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-4 text-sm font-medium text-white hover:bg-green-700"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Утвердить
                </button>
                <button
                  onClick={() => setActionType('reject')}
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

      {/* BOQ Info */}
      <div className="mb-4 rounded-lg border border-border bg-card p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Статус</div>
            <div className="mt-1"><BoqStatusBadge status={boq.status} /></div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Версия</div>
            <div className="mt-1 text-sm font-medium text-foreground">v{boq.version}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Позиций</div>
            <div className="mt-1 text-sm font-medium text-foreground">{items.length}</div>
          </div>
        </div>

        {boq.notes && (
          <div className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <strong>Примечание:</strong> {boq.notes}
          </div>
        )}
      </div>

      {/* Read-only items table */}
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full caption-bottom text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-8">
                #
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground w-[120px]">
                Раздел
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Наименование
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
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
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr
                key={item.id}
                className="border-b border-border transition-colors hover:bg-muted/50"
              >
                <td className="px-4 py-3 text-sm text-muted-foreground">{index + 1}</td>
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
                <td className="px-4 py-3 text-sm text-right">
                  {formatNumber(item.material_quantity)}
                </td>
                <td className="px-4 py-3 text-sm text-right">
                  {formatCurrency(item.unit_price)}
                </td>
                <td className="px-4 py-3 text-sm text-right font-medium">
                  {formatCurrency(item.total)}
                </td>
              </tr>
            ))}

            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground/50" />
                  <p className="mt-2">ВОР не содержит позиций</p>
                </td>
              </tr>
            )}
          </tbody>

          {/* Footer with totals */}
          {items.length > 0 && (
            <tfoot className="border-t-2 border-border bg-muted/50">
              {Object.entries(sectionTotals).map(([section, total]) => (
                <tr key={section} className="border-b border-border">
                  <td />
                  <td colSpan={6} className="px-4 py-2 text-sm font-medium text-muted-foreground text-right">
                    Итого по разделу "{section}":
                  </td>
                  <td className="px-4 py-2 text-sm text-right font-semibold text-foreground">
                    {formatCurrency(total)}
                  </td>
                </tr>
              ))}

              <tr>
                <td />
                <td colSpan={6} className="px-4 py-3 text-sm font-bold text-foreground text-right">
                  ИТОГО:
                </td>
                <td className="px-4 py-3 text-sm text-right font-bold text-foreground">
                  {formatCurrency(grandTotal)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Verify/Reject buttons at bottom for convenience */}
      {canVerify && items.length > 0 && (
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => setActionType('reject')}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-red-300 px-6 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
          >
            <XCircle className="h-4 w-4" />
            Отклонить ВОР
          </button>
          <button
            onClick={() => setActionType('approve')}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-green-600 px-6 text-sm font-medium text-white hover:bg-green-700"
          >
            <ShieldCheck className="h-4 w-4" />
            Утвердить ВОР
          </button>
        </div>
      )}

      {/* Action Dialog */}
      {actionType && (
        <ActionDialog
          type={actionType}
          isPending={approveBoq.isPending || updateBoq.isPending}
          onClose={() => setActionType(null)}
          onConfirm={handleAction}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActionDialog
// ---------------------------------------------------------------------------

function ActionDialog({
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
      ? 'Подтвердите утверждение ведомости объемов работ. После утверждения редактирование будет невозможно.'
      : 'Укажите причину отклонения. ВОР будет возвращен на доработку.'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">
            {type === 'reject' ? 'Причина отклонения *' : 'Комментарий (необязательно)'}
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className={cn(
              'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[100px]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'placeholder:text-muted-foreground'
            )}
            placeholder={
              type === 'reject'
                ? 'Укажите причину отклонения...'
                : 'Комментарий к утверждению...'
            }
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
