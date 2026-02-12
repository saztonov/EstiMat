'use client'

import { useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Loader2, ArrowLeft, Globe, Lock } from 'lucide-react'
import { PageHeader } from '@/shared/components'
import {
  useTenderDetail,
  TenderStatusBadge,
  LotCard,
  TENDER_TYPE_LABELS,
} from '@/entities/tender'
import { cn } from '@/shared/lib/utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '\u2014'
  return new Date(dateString).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function TenderDetailWidget() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const tenderId = params.id

  const {
    tender,
    lots,
    isLoading,
    publishTender,
    awardTender,
    isMutating,
  } = useTenderDetail(tenderId)

  const [awardDialogOpen, setAwardDialogOpen] = useState(false)
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null)

  const handlePublish = useCallback(async () => {
    if (!tenderId) return
    await publishTender(tenderId)
  }, [publishTender, tenderId])

  const handleAward = useCallback(async () => {
    if (!tenderId) return
    await awardTender({ id: tenderId, data: {} })
    setAwardDialogOpen(false)
  }, [awardTender, tenderId])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Загрузка тендера...</span>
      </div>
    )
  }

  if (!tender) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-foreground">Тендер не найден</p>
      </div>
    )
  }

  const canPublish = tender.status === 'draft'
  const canAward = tender.status === 'evaluation'

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Тендер #${tender.id.slice(0, 8).toUpperCase()}`}
        breadcrumbs={[
          { label: 'Тендеры', href: '/tenders' },
          { label: `#${tender.id.slice(0, 8).toUpperCase()}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/tenders')}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
              К списку
            </button>
            {canPublish && (
              <button
                type="button"
                onClick={handlePublish}
                disabled={isMutating}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-4 text-sm font-medium text-white shadow transition-colors',
                  'hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {isMutating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Globe className="h-4 w-4" />
                )}
                Опубликовать
              </button>
            )}
            {canAward && (
              <button
                type="button"
                onClick={() => setAwardDialogOpen(true)}
                disabled={isMutating}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
                  'hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                Определить победителя
              </button>
            )}
          </div>
        }
      />

      {/* Tender info header */}
      <div className="rounded-lg border border-border p-6">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Тип</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
              {tender.type === 'tender' ? (
                <Globe className="h-4 w-4 text-blue-500" />
              ) : (
                <Lock className="h-4 w-4 text-gray-500" />
              )}
              {TENDER_TYPE_LABELS[tender.type]}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Статус</p>
            <div className="mt-1">
              <TenderStatusBadge status={tender.status} size="md" />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Кол-во лотов</p>
            <p className="text-sm font-medium text-foreground">
              {lots.length}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Дедлайн</p>
            <p className="text-sm font-medium text-foreground">
              {formatDate(tender.period_end)}
            </p>
          </div>
        </div>
      </div>

      {/* Lots list */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-foreground">
          Лоты ({lots.length})
        </h3>

        {lots.length === 0 ? (
          <div className="rounded-lg border border-border py-12 text-center text-muted-foreground">
            Нет лотов в данном тендере
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lots.map((lot) => (
              <LotCard
                key={lot.id}
                lot={lot}
                onClick={(clickedLot) => setSelectedLotId(clickedLot.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Selected lot details */}
      {selectedLotId && (() => {
        const lot = lots.find((l) => l.id === selectedLotId)
        if (!lot) return null

        return (
          <div className="rounded-lg border border-border p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-lg font-semibold text-foreground">
                  {lot.material?.name ?? 'Лот'}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {lot.unit} | Объём: {new Intl.NumberFormat('ru-RU').format(lot.total_quantity)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLotId(null)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Закрыть
              </button>
            </div>

            {/* Lot materials and offers would go here */}
            <div className="rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                      Материал
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                      Кол-во
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                      Ед.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="px-4 py-3 text-foreground">
                      {lot.material?.name ?? '\u2014'}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {new Intl.NumberFormat('ru-RU').format(lot.total_quantity)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {lot.unit}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Offers section */}
            {lot.offers && lot.offers.length > 0 ? (
              <div>
                <h5 className="mb-2 text-sm font-semibold text-foreground">
                  Предложения поставщиков
                </h5>
                <div className="overflow-hidden rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                          Поставщик
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                          Цена за ед.
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                          Итого
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {lot.offers.map((offer: { id: string; supplier_name?: string; unit_price?: number; total?: number }) => (
                        <tr
                          key={offer.id}
                          className="border-b border-border transition-colors hover:bg-muted/50"
                        >
                          <td className="px-4 py-3 text-foreground">
                            {offer.supplier_name ?? '\u2014'}
                          </td>
                          <td className="px-4 py-3 text-right text-foreground">
                            {formatCurrency(offer.unit_price)}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-foreground">
                            {formatCurrency(offer.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Предложения ещё не поступали.
              </p>
            )}
          </div>
        )
      })()}

      {/* Award dialog */}
      {awardDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
            <h4 className="text-lg font-semibold text-foreground">
              Определить победителя
            </h4>
            <p className="mt-2 text-sm text-muted-foreground">
              Вы уверены, что хотите определить победителя для данного тендера?
              Это действие нельзя отменить.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAwardDialogOpen(false)}
                className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleAward}
                disabled={isMutating}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
                  'hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {isMutating && <Loader2 className="h-4 w-4 animate-spin" />}
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
