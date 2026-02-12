'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Check, Layers } from 'lucide-react'
import { PageHeader } from '@/shared/components'
import { ConsolidationPanel, ConsolidationPreview } from '@/features/consolidate-requests'
import { useCreateTender } from '@/entities/tender'
import { cn } from '@/shared/lib/utils'

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function TenderConsolidationWidget() {
  const router = useRouter()
  const createTender = useCreateTender()

  const [step, setStep] = useState<'select' | 'preview'>('select')
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const handleGroupsSelected = useCallback((groupIds: string[]) => {
    setSelectedGroupIds(groupIds)
    if (groupIds.length > 0) {
      setStep('preview')
    }
  }, [])

  const handleConfirm = useCallback(async () => {
    setSubmitting(true)
    try {
      // Create tender from consolidated items
      const tender = await createTender.mutateAsync({
        type: 'tender',
        status: 'draft',
        material_group_id: selectedGroupIds[0] ?? null,
        notes: selectedGroupIds.length > 1 ? `Консолидация ${selectedGroupIds.length} групп` : undefined,
      })
      router.push(`/tenders/${tender.id}`)
    } catch {
      // Error handled by mutation hook
    } finally {
      setSubmitting(false)
    }
  }, [createTender, selectedGroupIds, router])

  const handleBack = useCallback(() => {
    if (step === 'preview') {
      setStep('select')
    } else {
      router.push('/tenders')
    }
  }, [step, router])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Консолидация заявок"
        description="Объедините заявки в тендеры для оптимальной закупки"
        breadcrumbs={[
          { label: 'Тендеры', href: '/tenders' },
          { label: 'Консолидация' },
        ]}
        actions={
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </button>
        }
      />

      {/* Step indicator */}
      <div className="flex items-center gap-4">
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border px-4 py-2',
            step === 'select'
              ? 'border-primary bg-primary/5'
              : 'border-border'
          )}
        >
          <Layers className="h-4 w-4" />
          <span className="text-sm font-medium">1. Выбор позиций</span>
        </div>
        <div className="h-px w-8 bg-border" />
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border px-4 py-2',
            step === 'preview'
              ? 'border-primary bg-primary/5'
              : 'border-border'
          )}
        >
          <Check className="h-4 w-4" />
          <span className="text-sm font-medium">2. Предпросмотр и подтверждение</span>
        </div>
      </div>

      {/* Step 1: Selection */}
      {step === 'select' && (
        <ConsolidationPanel onGroupsSelected={handleGroupsSelected} />
      )}

      {/* Step 2: Preview & Confirm */}
      {step === 'preview' && (
        <div className="space-y-6">
          <ConsolidationPreview groupIds={selectedGroupIds} />

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep('select')}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
              Назад к выбору
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || selectedGroupIds.length === 0}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
                'hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Создание тендера...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Создать тендер
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
