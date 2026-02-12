'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ArrowRight, Loader2, Check } from 'lucide-react'
import { PageHeader } from '@/shared/components'
import { useBoqs, useBoqItems } from '@/entities/boq'
import { OrgSelect } from '@/entities/organization'
import {
  useCreateEstimate,
  useCreateEstimateItem,
} from '@/entities/estimate'
import { cn } from '@/shared/lib/utils'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const step1Schema = z.object({
  boq_id: z.string().min(1, 'Выберите ВОР'),
})

const step2Schema = z.object({
  contractor_id: z.string().min(1, 'Выберите подрядчика'),
})

type Step1Values = z.infer<typeof step1Schema>
type Step2Values = z.infer<typeof step2Schema>

interface ImportedItem {
  boq_item_id: string
  description: string
  unit: string
  quantity: number
  unit_price: number
  selected: boolean
}

// ---------------------------------------------------------------------------
// Step indicators
// ---------------------------------------------------------------------------

const STEPS = [
  'Выбор ВОР',
  'Подрядчик',
  'Позиции и цены',
  'Проверка и отправка',
]

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <nav className="mb-8">
      <ol className="flex items-center gap-2">
        {STEPS.map((label, index) => {
          const stepNum = index + 1
          const isActive = stepNum === currentStep
          const isCompleted = stepNum < currentStep

          return (
            <li key={index} className="flex items-center gap-2">
              {index > 0 && (
                <div
                  className={cn(
                    'h-px w-8',
                    isCompleted ? 'bg-primary' : 'bg-border'
                  )}
                />
              )}
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                  isActive && 'bg-primary text-primary-foreground',
                  isCompleted && 'bg-primary/20 text-primary',
                  !isActive && !isCompleted && 'bg-muted text-muted-foreground'
                )}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : stepNum}
              </div>
              <span
                className={cn(
                  'hidden text-sm sm:inline',
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground'
                )}
              >
                {label}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
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

export function EstimateFormWidget() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const projectId = params.id

  const [step, setStep] = useState(1)
  const [selectedBoqId, setSelectedBoqId] = useState('')
  const [contractorId, setContractorId] = useState('')
  const [importedItems, setImportedItems] = useState<ImportedItem[]>([])
  const [submitting, setSubmitting] = useState(false)

  const createEstimate = useCreateEstimate()
  const createItem = useCreateEstimateItem()

  // Step 1: BOQ list
  const { data: boqsData, isLoading: boqsLoading } = useBoqs(projectId)
  const boqs = useMemo(() => boqsData?.data ?? [], [boqsData])

  // Step 3: BOQ items once BOQ is selected
  const { data: boqItems, isLoading: boqItemsLoading } = useBoqItems(selectedBoqId)

  // Forms
  const step1Form = useForm<Step1Values>({
    resolver: zodResolver(step1Schema),
    defaultValues: { boq_id: '' },
  })

  const step2Form = useForm<Step2Values>({
    resolver: zodResolver(step2Schema),
    defaultValues: { contractor_id: '' },
  })

  // Step 1 submit: save BOQ selection, move to step 2
  const onStep1Submit = useCallback(
    (data: Step1Values) => {
      setSelectedBoqId(data.boq_id)
      setStep(2)
    },
    []
  )

  // Step 2 submit: save contractor, load items, move to step 3
  const onStep2Submit = useCallback(
    (data: Step2Values) => {
      setContractorId(data.contractor_id)
      // Initialize imported items from BOQ items
      if (boqItems) {
        setImportedItems(
          boqItems.map((item) => ({
            boq_item_id: item.id,
            description: item.material?.name ?? item.work_type ?? '',
            unit: item.unit,
            quantity: item.material_quantity ?? item.work_quantity ?? 0,
            unit_price: item.unit_price ?? 0,
            selected: true,
          }))
        )
      }
      setStep(3)
    },
    [boqItems]
  )

  // Step 3: update individual item prices
  const handlePriceChange = useCallback((index: number, price: number) => {
    setImportedItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, unit_price: price } : item
      )
    )
  }, [])

  const handleToggleItem = useCallback((index: number) => {
    setImportedItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, selected: !item.selected } : item
      )
    )
  }, [])

  // Compute totals for review
  const selectedItems = useMemo(
    () => importedItems.filter((item) => item.selected),
    [importedItems]
  )

  const totalAmount = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0),
    [selectedItems]
  )

  // Step 4: final submit
  const handleFinalSubmit = useCallback(async () => {
    setSubmitting(true)
    try {
      const estimate = await createEstimate.mutateAsync({
        projectId,
        boq_id: selectedBoqId,
        contractor_id: contractorId || null,
      })

      // Create items sequentially
      for (const item of selectedItems) {
        await createItem.mutateAsync({
          estimateId: estimate.id,
          boq_item_id: item.boq_item_id,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
        })
      }

      router.push(`/projects/${projectId}/estimates/${estimate.id}`)
    } catch {
      // Error handled by mutation hooks
    } finally {
      setSubmitting(false)
    }
  }, [
    createEstimate,
    createItem,
    projectId,
    selectedBoqId,
    contractorId,
    selectedItems,
    router,
  ])

  const goBack = useCallback(() => {
    if (step > 1) setStep(step - 1)
    else router.push(`/projects/${projectId}/estimates`)
  }, [step, router, projectId])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Новая смета"
        breadcrumbs={[
          { label: 'Проекты', href: '/projects' },
          { label: 'Проект', href: `/projects/${projectId}` },
          { label: 'Сметы', href: `/projects/${projectId}/estimates` },
          { label: 'Новая смета' },
        ]}
      />

      <StepIndicator currentStep={step} />

      {/* ---------------------------------------------------------------- */}
      {/* Step 1: Select BOQ */}
      {/* ---------------------------------------------------------------- */}
      {step === 1 && (
        <form onSubmit={step1Form.handleSubmit(onStep1Submit)} className="space-y-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Ведомость объёмов работ (ВОР)
            </label>
            {boqsLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка...
              </div>
            ) : boqs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Нет доступных ВОР для данного проекта.
              </p>
            ) : (
              <Controller
                control={step1Form.control}
                name="boq_id"
                render={({ field }) => (
                  <div className="space-y-2">
                    {boqs.map((boq) => (
                      <label
                        key={boq.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors',
                          field.value === boq.id
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-muted/50'
                        )}
                      >
                        <input
                          type="radio"
                          value={boq.id}
                          checked={field.value === boq.id}
                          onChange={() => field.onChange(boq.id)}
                          className="h-4 w-4 text-primary"
                        />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            ВОР #{boq.id.slice(0, 8)}
                            {boq.version != null && ` (v${boq.version})`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Статус: {boq.status} | Позиций: {boq.items_count ?? '\u2014'}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              />
            )}
            {step1Form.formState.errors.boq_id && (
              <p className="mt-1 text-sm text-red-500">
                {step1Form.formState.errors.boq_id.message}
              </p>
            )}
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
              Назад
            </button>
            <button
              type="submit"
              disabled={boqs.length === 0}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
                'hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              Далее
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Step 2: Select Contractor */}
      {/* ---------------------------------------------------------------- */}
      {step === 2 && (
        <form onSubmit={step2Form.handleSubmit(onStep2Submit)} className="space-y-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Подрядчик
            </label>
            <Controller
              control={step2Form.control}
              name="contractor_id"
              render={({ field }) => (
                <OrgSelect
                  value={field.value}
                  onChange={field.onChange}
                  orgType="contractor"
                  placeholder="Выберите подрядчика"
                />
              )}
            />
            {step2Form.formState.errors.contractor_id && (
              <p className="mt-1 text-sm text-red-500">
                {step2Form.formState.errors.contractor_id.message}
              </p>
            )}
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
              Назад
            </button>
            <button
              type="submit"
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
                'hover:bg-primary/90'
              )}
            >
              Далее
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Step 3: Import items from BOQ and set prices */}
      {/* ---------------------------------------------------------------- */}
      {step === 3 && (
        <div className="space-y-6">
          <div>
            <h3 className="mb-4 text-lg font-semibold text-foreground">
              Позиции из ВОР
            </h3>
            {boqItemsLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка позиций...
              </div>
            ) : importedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Нет позиций в выбранной ВОР.
              </p>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/50">
                    <tr>
                      <th className="w-10 px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={importedItems.every((i) => i.selected)}
                          onChange={() => {
                            const allSelected = importedItems.every((i) => i.selected)
                            setImportedItems((prev) =>
                              prev.map((i) => ({ ...i, selected: !allSelected }))
                            )
                          }}
                          className="h-4 w-4"
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                        Наименование
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                        Ед. изм.
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                        Кол-во
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
                    {importedItems.map((item, index) => (
                      <tr
                        key={item.boq_item_id}
                        className={cn(
                          'border-b border-border transition-colors',
                          !item.selected && 'opacity-50'
                        )}
                      >
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={() => handleToggleItem(index)}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="px-4 py-3 text-foreground">{item.description}</td>
                        <td className="px-4 py-3 text-muted-foreground">{item.unit}</td>
                        <td className="px-4 py-3 text-right text-foreground">
                          {new Intl.NumberFormat('ru-RU').format(item.quantity)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={item.unit_price}
                            onChange={(e) =>
                              handlePriceChange(index, parseFloat(e.target.value) || 0)
                            }
                            disabled={!item.selected}
                            className={cn(
                              'w-28 rounded-md border border-input bg-transparent px-2 py-1 text-right text-sm',
                              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                              'disabled:cursor-not-allowed disabled:opacity-50'
                            )}
                          />
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-foreground">
                          {formatCurrency(item.quantity * item.unit_price)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30">
                      <td colSpan={5} className="px-4 py-3 text-right text-sm font-semibold text-foreground">
                        Итого (выбранные):
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-foreground">
                        {formatCurrency(totalAmount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
              Назад
            </button>
            <button
              type="button"
              onClick={() => setStep(4)}
              disabled={selectedItems.length === 0}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
                'hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              Далее
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Step 4: Review and Submit */}
      {/* ---------------------------------------------------------------- */}
      {step === 4 && (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-foreground">
            Проверка и отправка
          </h3>

          <div className="rounded-lg border border-border p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">ВОР</p>
                <p className="text-sm font-medium text-foreground">
                  #{selectedBoqId.slice(0, 8)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Подрядчик</p>
                <p className="text-sm font-medium text-foreground">
                  {contractorId ? `#${contractorId.slice(0, 8)}` : '\u2014'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Позиций</p>
                <p className="text-sm font-medium text-foreground">
                  {selectedItems.length}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Общая сумма</p>
                <p className="text-sm font-bold text-foreground">
                  {formatCurrency(totalAmount)}
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                    Наименование
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                    Ед.
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                    Кол-во
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                    Цена
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                    Итого
                  </th>
                </tr>
              </thead>
              <tbody>
                {selectedItems.map((item) => (
                  <tr key={item.boq_item_id} className="border-b border-border">
                    <td className="px-4 py-3 text-foreground">{item.description}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.unit}</td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {new Intl.NumberFormat('ru-RU').format(item.quantity)}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {formatCurrency(item.unit_price)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">
                      {formatCurrency(item.quantity * item.unit_price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
              Назад
            </button>
            <button
              type="button"
              onClick={handleFinalSubmit}
              disabled={submitting}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
                'hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Сохранение...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Создать смету
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
