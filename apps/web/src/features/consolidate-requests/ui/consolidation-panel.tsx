'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Package, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { ApiResponse } from '@/shared/types/api'

interface ConsolidationItem {
  id: string
  material_name: string
  material_group: string
  material_group_id: string
  unit: string
  quantity: number
  request_id: string
  request_number: string
}

interface MaterialGroupSummary {
  groupId: string
  groupName: string
  items: ConsolidationItem[]
  totalQuantity: number
  uniqueMaterials: number
}

interface ConsolidationPanelProps {
  onGroupsSelected?: (groupIds: string[]) => void
}

export function ConsolidationPanel({ onGroupsSelected }: ConsolidationPanelProps = {}) {
  const queryClient = useQueryClient()
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Fetch pending pr_items from approved gp_supply requests
  const { data: items = [], isLoading } = useQuery<ConsolidationItem[]>({
    queryKey: ['consolidation', 'pending-items'],
    queryFn: async () => {
      const res = await fetch('/api/v1/tenders/consolidate/preview')

      if (!res.ok) {
        const body: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(
          body.error?.message ?? 'Не удалось загрузить позиции для консолидации'
        )
      }

      const body: ApiResponse<ConsolidationItem[]> = await res.json()
      return body.data ?? []
    },
  })

  // Consolidation mutation
  const consolidateMutation = useMutation({
    mutationFn: async (): Promise<{ tenders_created: number; lots_created: number }> => {
      const res = await fetch('/api/v1/tenders/consolidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        const body: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(body.error?.message ?? 'Не удалось выполнить консолидацию')
      }

      const body: ApiResponse<{ tenders_created: number; lots_created: number }> =
        await res.json()
      return body.data!
    },
    onSuccess: (data) => {
      setSuccessMessage(
        `Консолидация завершена: создано ${data.tenders_created} тендеров, ${data.lots_created} лотов`
      )
      queryClient.invalidateQueries({ queryKey: ['consolidation'] })
      queryClient.invalidateQueries({ queryKey: ['tenders'] })
      queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
    onError: (err) => {
      setError(
        err instanceof Error ? err.message : 'Ошибка консолидации'
      )
    },
  })

  // Group items by material_group
  const groupedItems = useMemo<MaterialGroupSummary[]>(() => {
    const groupsMap = new Map<string, ConsolidationItem[]>()

    for (const item of items) {
      const existing = groupsMap.get(item.material_group_id) ?? []
      existing.push(item)
      groupsMap.set(item.material_group_id, existing)
    }

    return Array.from(groupsMap.entries())
      .map(([groupId, groupItems]) => ({
        groupId,
        groupName: groupItems[0].material_group,
        items: groupItems,
        totalQuantity: groupItems.reduce((sum, i) => sum + i.quantity, 0),
        uniqueMaterials: new Set(groupItems.map((i) => i.material_name)).size,
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName, 'ru'))
  }, [items])

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }, [])

  const handleConsolidate = useCallback(() => {
    setError(null)
    setSuccessMessage(null)
    consolidateMutation.mutate()
  }, [consolidateMutation])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-3 text-sm text-muted-foreground">
          Загрузка позиций для консолидации...
        </span>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12">
        <Package className="h-10 w-10 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          Нет позиций для консолидации
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Позиции появятся после утверждения заявок ГП на снабжение
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Позиции для консолидации
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {items.length} позиций из {new Set(items.map((i) => i.request_id)).size} заявок, {groupedItems.length} групп материалов
          </p>
        </div>
        <button
          type="button"
          onClick={handleConsolidate}
          disabled={consolidateMutation.isPending || items.length === 0}
          className={cn(
            'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
            'hover:bg-primary/90',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          {consolidateMutation.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Консолидировать
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          {successMessage}
        </div>
      )}

      {/* Grouped items */}
      <div className="divide-y divide-border rounded-lg border border-border">
        {groupedItems.map((group) => {
          const isExpanded = expandedGroups.has(group.groupId)

          return (
            <div key={group.groupId}>
              {/* Group header */}
              <button
                type="button"
                onClick={() => toggleGroup(group.groupId)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground">
                    {group.groupName}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{group.uniqueMaterials} мат.</span>
                  <span>{group.items.length} поз.</span>
                </div>
              </button>

              {/* Expanded items */}
              {isExpanded && (
                <div className="border-t border-border bg-muted/30">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Материал</th>
                        <th className="px-4 py-2 font-medium">Ед. изм.</th>
                        <th className="px-4 py-2 text-right font-medium">
                          Количество
                        </th>
                        <th className="px-4 py-2 font-medium">Заявка</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {group.items.map((item) => (
                        <tr key={item.id} className="hover:bg-muted/50">
                          <td className="px-4 py-2 text-foreground">
                            {item.material_name}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {item.unit}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-foreground">
                            {item.quantity.toLocaleString('ru-RU')}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {item.request_number}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
