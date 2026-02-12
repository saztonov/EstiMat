'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, FileStack, ArrowRight } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { ApiResponse } from '@/shared/types/api'

interface PreviewLot {
  material_group: string
  material_group_id: string
  items_count: number
  total_quantity: number
  unit: string
  materials: string[]
}

interface ConsolidationPreviewData {
  new_tenders: PreviewLot[]
  long_term_orders: PreviewLot[]
  total_items: number
}

interface ConsolidationPreviewProps {
  groupIds?: string[]
}

export function ConsolidationPreview({ groupIds }: ConsolidationPreviewProps = {}) {
  const { data: preview, isLoading, isError, error } = useQuery<ConsolidationPreviewData>({
    queryKey: ['consolidation', 'preview-result'],
    queryFn: async () => {
      const res = await fetch('/api/v1/tenders/consolidate/preview-result')

      if (!res.ok) {
        const body: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(
          body.error?.message ?? 'Не удалось загрузить предпросмотр консолидации'
        )
      }

      const body: ApiResponse<ConsolidationPreviewData> = await res.json()
      return body.data!
    },
  })

  const stats = useMemo(() => {
    if (!preview) return null

    return {
      newTendersCount: preview.new_tenders.length,
      longTermCount: preview.long_term_orders.length,
      totalItems: preview.total_items,
      newTendersItems: preview.new_tenders.reduce(
        (sum, lot) => sum + lot.items_count,
        0
      ),
      longTermItems: preview.long_term_orders.reduce(
        (sum, lot) => sum + lot.items_count,
        0
      ),
    }
  }, [preview])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Загрузка предпросмотра...
        </span>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        {error instanceof Error
          ? error.message
          : 'Ошибка загрузки предпросмотра'}
      </div>
    )
  }

  if (!preview || (preview.new_tenders.length === 0 && preview.long_term_orders.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-8">
        <FileStack className="h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Нет данных для предпросмотра
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Всего позиций
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {stats.totalItems}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Новые тендеры
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {stats.newTendersCount}
            </p>
            <p className="text-xs text-muted-foreground">
              {stats.newTendersItems} поз.
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Долгосрочные заказы
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {stats.longTermCount}
            </p>
            <p className="text-xs text-muted-foreground">
              {stats.longTermItems} поз.
            </p>
          </div>
        </div>
      )}

      {/* New tenders */}
      {preview.new_tenders.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-semibold text-foreground">
            Будут созданы новые тендеры
          </h4>
          <div className="space-y-2">
            {preview.new_tenders.map((lot) => (
              <LotPreviewCard key={lot.material_group_id} lot={lot} type="tender" />
            ))}
          </div>
        </div>
      )}

      {/* Long-term orders */}
      {preview.long_term_orders.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-semibold text-foreground">
            Будут добавлены в долгосрочные заказы
          </h4>
          <div className="space-y-2">
            {preview.long_term_orders.map((lot) => (
              <LotPreviewCard
                key={lot.material_group_id}
                lot={lot}
                type="long_term"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LotPreviewCard({
  lot,
  type,
}: {
  lot: PreviewLot
  type: 'tender' | 'long_term'
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        type === 'tender'
          ? 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950'
          : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950'
      )}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {lot.material_group}
          </p>
          <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
            <span>{lot.items_count} позиций</span>
            <span>
              {lot.total_quantity.toLocaleString('ru-RU')} {lot.unit}
            </span>
          </div>
        </div>
        <ArrowRight
          className={cn(
            'h-4 w-4 shrink-0',
            type === 'tender' ? 'text-blue-500' : 'text-amber-500'
          )}
        />
      </div>

      {lot.materials.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {lot.materials.slice(0, 5).map((name) => (
            <span
              key={name}
              className="inline-block rounded bg-background/80 px-2 py-0.5 text-xs text-muted-foreground"
            >
              {name}
            </span>
          ))}
          {lot.materials.length > 5 && (
            <span className="inline-block px-2 py-0.5 text-xs text-muted-foreground">
              +{lot.materials.length - 5} ещё
            </span>
          )}
        </div>
      )}
    </div>
  )
}
