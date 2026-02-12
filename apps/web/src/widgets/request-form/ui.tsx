'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ArrowRight, Loader2, Check } from 'lucide-react'
import { PageHeader } from '@/shared/components'
import {
  useEstimates,
  useEstimateItems,
  type EstimateWithRelations,
  type EstimateItemWithRelations,
} from '@/entities/estimate'
import {
  useCreateRequest,
  useCreateRequestItem,
  type FundingType,
} from '@/entities/request'
import { cn } from '@/shared/lib/utils'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const step1Schema = z.object({
  estimate_id: z.string().min(1, 'Выберите смету'),
})

const step2Schema = z.object({
  funding_type: z.enum(['gp_supply', 'obs_letter', 'advance'], {
    required_error: 'Выберите тип финансирования',
  }),
})

const step4Schema = z.object({
  deadline: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  notes: z.string().optional(),
})

type Step1Values = z.infer<typeof step1Schema>
type Step2Values = z.infer<typeof step2Schema>
type Step4Values = z.infer<typeof step4Schema>

interface SelectedItem {
  estimate_item_id: string
  material_id: string
  material_name: string
  unit: string
  available_qty: number
  selected_qty: number
  selected: boolean
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const STEPS = ['Смета', 'Тип финансирования', 'Позиции', 'Параметры']

const FUNDING_OPTIONS: { value: FundingType; label: string; description: string }[] = [
  {
    value: 'gp_supply',
    label: 'Снабжение ГП',
    description: 'Закупка через генподрядчика',
  },
  {
    value: 'obs_letter',
    label: 'Распределительное письмо',
    description: 'Закупка через распределительное письмо от ОБС',
  },
  {
    value: 'advance',
    label: 'Авансирование',
    description: 'Закупка через авансовый платёж',
  },
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
// Widget
// ---------------------------------------------------------------------------

export function RequestFormWidget() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const projectId = params.id

  const [step, setStep] = useState(1)
  const [selectedEstimateId, setSelectedEstimateId] = useState('')
  const [fundingType, setFundingType] = useState<FundingType>('gp_supply')
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([])
  const [submitting, setSubmitting] = useState(false)

  const createRequest = useCreateRequest()
  const createRequestItem = useCreateRequestItem()

  // Step 1: Estimates list (approved)
  const { data: estimatesData, isLoading: estimatesLoading } = useEstimates(projectId, {
    status: 'approved',
  })
  const estimates = useMemo(() => estimatesData?.data ?? [], [estimatesData])

  // Step 3: Estimate items for selected estimate
  const { data: estimateItems, isLoading: itemsLoading } = useEstimateItems(selectedEstimateId)

  // Forms
  const step1Form = useForm<Step1Values>({
    resolver: zodResolver(step1Schema),
    defaultValues: { estimate_id: '' },
  })

  const step2Form = useForm<Step2Values>({
    resolver: zodResolver(step2Schema),
    defaultValues: { funding_type: 'gp_supply' },
  })

  const step4Form = useForm<Step4Values>({
    resolver: zodResolver(step4Schema),
    defaultValues: { priority: 'normal', deadline: '', notes: '' },
  })

  const onStep1Submit = useCallback(
    (data: Step1Values) => {
      setSelectedEstimateId(data.estimate_id)
      setStep(2)
    },
    []
  )

  const onStep2Submit = useCallback(
    (data: Step2Values) => {
      setFundingType(data.funding_type)
      // Initialize items from estimate
      if (estimateItems) {
        setSelectedItems(
          estimateItems.map((item) => ({
            estimate_item_id: item.id,
            material_id: item.material?.id ?? '',
            material_name: item.description ?? item.material?.name ?? '',
            unit: item.unit,
            available_qty: item.quantity ?? 0,
            selected_qty: item.quantity ?? 0,
            selected: true,
          }))
        )
      }
      setStep(3)
    },
    [estimateItems]
  )

  const handleToggleItem = useCallback((index: number) => {
    setSelectedItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, selected: !item.selected } : item
      )
    )
  }, [])

  const handleQtyChange = useCallback((index: number, qty: number) => {
    setSelectedItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, selected_qty: Math.min(qty, item.available_qty) }
          : item
      )
    )
  }, [])

  const activeItems = useMemo(
    () => selectedItems.filter((item) => item.selected && item.selected_qty > 0),
    [selectedItems]
  )

  const onStep4Submit = useCallback(
    async (data: Step4Values) => {
      setSubmitting(true)
      try {
        // Find estimate to get contractor_id
        const selectedEstimate = estimates.find((e) => e.id === selectedEstimateId)

        const request = await createRequest.mutateAsync({
          projectId,
          estimate_id: selectedEstimateId,
          contractor_id: selectedEstimate?.contractor?.id ?? '',
          funding_type: fundingType,
          deadline: data.deadline || null,
          notes: data.notes || null,
        })

        // Create items
        for (const item of activeItems) {
          await createRequestItem.mutateAsync({
            requestId: request.id,
            estimate_item_id: item.estimate_item_id,
            material_id: item.material_id,
            quantity: item.selected_qty,
            unit: item.unit,
            required_date: data.deadline || null,
          })
        }

        router.push(`/projects/${projectId}/requests/${request.id}`)
      } catch {
        // Error handled by mutation hooks
      } finally {
        setSubmitting(false)
      }
    },
    [
      createRequest,
      createRequestItem,
      projectId,
      selectedEstimateId,
      fundingType,
      activeItems,
      estimates,
      router,
    ]
  )

  const goBack = useCallback(() => {
    if (step > 1) setStep(step - 1)
    else router.push(`/projects/${projectId}/requests`)
  }, [step, router, projectId])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Новая заявка"
        breadcrumbs={[
          { label: 'Проекты', href: '/projects' },
          { label: 'Проект', href: `/projects/${projectId}` },
          { label: 'Заявки', href: `/projects/${projectId}/requests` },
          { label: 'Новая заявка' },
        ]}
      />

      <StepIndicator currentStep={step} />

      {/* ---------------------------------------------------------------- */}
      {/* Step 1: Select Estimate */}
      {/* ---------------------------------------------------------------- */}
      {step === 1 && (
        <form onSubmit={step1Form.handleSubmit(onStep1Submit)} className="space-y-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Смета-основание
            </label>
            {estimatesLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка смет...
              </div>
            ) : estimates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Нет утверждённых смет. Сначала создайте и утвердите смету.
              </p>
            ) : (
              <Controller
                control={step1Form.control}
                name="estimate_id"
                render={({ field }) => (
                  <div className="space-y-2">
                    {estimates.map((est) => (
                      <label
                        key={est.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors',
                          field.value === est.id
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-muted/50'
                        )}
                      >
                        <input
                          type="radio"
                          value={est.id}
                          checked={field.value === est.id}
                          onChange={() => field.onChange(est.id)}
                          className="h-4 w-4 text-primary"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-foreground">
                            {est.work_type ?? `Смета #${est.id.slice(0, 8)}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Подрядчик: {est.contractor?.name ?? '\u2014'} | Позиций: {est.items_count ?? '\u2014'}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              />
            )}
            {step1Form.formState.errors.estimate_id && (
              <p className="mt-1 text-sm text-red-500">
                {step1Form.formState.errors.estimate_id.message}
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
              disabled={estimates.length === 0}
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
      {/* Step 2: Funding Type */}
      {/* ---------------------------------------------------------------- */}
      {step === 2 && (
        <form onSubmit={step2Form.handleSubmit(onStep2Submit)} className="space-y-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Тип финансирования
            </label>
            <Controller
              control={step2Form.control}
              name="funding_type"
              render={({ field }) => (
                <div className="space-y-2">
                  {FUNDING_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors',
                        field.value === opt.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/50'
                      )}
                    >
                      <input
                        type="radio"
                        value={opt.value}
                        checked={field.value === opt.value}
                        onChange={() => field.onChange(opt.value)}
                        className="h-4 w-4 text-primary"
                      />
                      <div>
                        <p className="text-sm font-medium text-foreground">{opt.label}</p>
                        <p className="text-xs text-muted-foreground">{opt.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            />
            {step2Form.formState.errors.funding_type && (
              <p className="mt-1 text-sm text-red-500">
                {step2Form.formState.errors.funding_type.message}
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
      {/* Step 3: Select Items */}
      {/* ---------------------------------------------------------------- */}
      {step === 3 && (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-foreground">
            Выбор позиций из сметы
          </h3>

          {itemsLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка позиций...
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50">
                  <tr>
                    <th className="w-10 px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedItems.every((i) => i.selected)}
                        onChange={() => {
                          const allSelected = selectedItems.every((i) => i.selected)
                          setSelectedItems((prev) =>
                            prev.map((i) => ({ ...i, selected: !allSelected }))
                          )
                        }}
                        className="h-4 w-4"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                      Материал
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                      Ед.
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                      Доступно
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                      Кол-во в заявке
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selectedItems.map((item, index) => (
                    <tr
                      key={item.estimate_item_id}
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
                      <td className="px-4 py-3 text-foreground">{item.material_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.unit}</td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {new Intl.NumberFormat('ru-RU').format(item.available_qty)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          min={0}
                          max={item.available_qty}
                          step={1}
                          value={item.selected_qty}
                          onChange={(e) =>
                            handleQtyChange(index, parseFloat(e.target.value) || 0)
                          }
                          disabled={!item.selected}
                          className={cn(
                            'w-28 rounded-md border border-input bg-transparent px-2 py-1 text-right text-sm',
                            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                            'disabled:cursor-not-allowed disabled:opacity-50'
                          )}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
              disabled={activeItems.length === 0}
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
      {/* Step 4: Deadlines, priority, notes */}
      {/* ---------------------------------------------------------------- */}
      {step === 4 && (
        <form onSubmit={step4Form.handleSubmit(onStep4Submit)} className="space-y-6">
          <h3 className="text-lg font-semibold text-foreground">
            Параметры заявки
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Дедлайн
              </label>
              <input
                type="date"
                {...step4Form.register('deadline')}
                className={cn(
                  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                )}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Приоритет
              </label>
              <select
                {...step4Form.register('priority')}
                className={cn(
                  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                )}
              >
                <option value="low">Низкий</option>
                <option value="normal">Нормальный</option>
                <option value="high">Высокий</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Примечания
            </label>
            <textarea
              {...step4Form.register('notes')}
              rows={3}
              placeholder="Дополнительные комментарии..."
              className={cn(
                'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
              )}
            />
          </div>

          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">
              Позиций в заявке: <strong className="text-foreground">{activeItems.length}</strong>
            </p>
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
              disabled={submitting}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
                'hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Создание...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Создать заявку
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
