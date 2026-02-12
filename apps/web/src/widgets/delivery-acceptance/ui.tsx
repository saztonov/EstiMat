'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Camera,
  CheckCircle,
  Loader2,
  AlertTriangle,
  QrCode,
  Pen,
  X,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components'
import { useDeliveryDetail, DeliveryStatusBadge } from '@/entities/delivery'
import type { DeliveryItemWithRelations } from '@estimat/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AcceptanceLineState {
  itemId: string
  actualQuantity: string
  qualityOk: boolean
  note: string
}

interface DeliveryAcceptanceWidgetProps {
  deliveryId: string
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AcceptanceItemCard({
  item,
  state,
  onChange,
}: {
  item: DeliveryItemWithRelations
  state: AcceptanceLineState
  onChange: (update: Partial<AcceptanceLineState>) => void
}) {
  const materialName =
    item.material_name ??
    item.material?.name ??
    item.id.slice(0, 8)

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-foreground">{materialName as string}</p>
          <p className="text-xs text-muted-foreground">
            Ожидаемое кол-во: {item.expected_quantity ?? '\u2014'}
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={state.qualityOk}
            onChange={(e) => onChange({ qualityOk: e.target.checked })}
            className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
          />
          <span className="text-xs font-medium text-muted-foreground">
            Качество ОК
          </span>
        </label>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Фактическое количество
        </label>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={state.actualQuantity}
          onChange={(e) => onChange({ actualQuantity: e.target.value })}
          placeholder="0"
          className={cn(
            'flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors',
            'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'text-lg font-semibold tabular-nums'
          )}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Примечание
        </label>
        <input
          type="text"
          value={state.note}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="Комментарий..."
          className={cn(
            'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
            'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
          )}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Signature pad (placeholder canvas)
// ---------------------------------------------------------------------------

function SignaturePad({
  onClear,
}: {
  onClear: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)

  const startDraw = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      setIsDrawing(true)
      ctx.beginPath()

      const rect = canvas.getBoundingClientRect()
      const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left
      const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top
      ctx.moveTo(x, y)
    },
    []
  )

  const draw = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      if (!isDrawing) return
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const rect = canvas.getBoundingClientRect()
      const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left
      const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top

      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.strokeStyle = 'currentColor'
      ctx.lineTo(x, y)
      ctx.stroke()
    },
    [isDrawing]
  )

  const endDraw = useCallback(() => {
    setIsDrawing(false)
  }, [])

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    onClear()
  }, [onClear])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">Подпись</label>
        <button
          type="button"
          onClick={handleClear}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Очистить
        </button>
      </div>
      <div className="rounded-lg border border-border bg-white dark:bg-gray-950 overflow-hidden touch-none">
        <canvas
          ref={canvasRef}
          width={400}
          height={150}
          className="w-full h-[150px] cursor-crosshair"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Widget
// ---------------------------------------------------------------------------

export function DeliveryAcceptanceWidget({ deliveryId }: DeliveryAcceptanceWidgetProps) {
  const router = useRouter()
  const {
    delivery,
    items,
    isLoading,
    isError,
    error,
    acceptDelivery,
    isMutating,
  } = useDeliveryDetail(deliveryId)

  // Per-item acceptance state
  const [lineStates, setLineStates] = useState<Map<string, AcceptanceLineState>>(
    new Map()
  )
  const [photos, setPhotos] = useState<File[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showQrScanner, setShowQrScanner] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Initialize line states when items change
  const getLineState = useCallback(
    (itemId: string): AcceptanceLineState =>
      lineStates.get(itemId) ?? {
        itemId,
        actualQuantity: '',
        qualityOk: true,
        note: '',
      },
    [lineStates]
  )

  const updateLineState = useCallback(
    (itemId: string, update: Partial<AcceptanceLineState>) => {
      setLineStates((prev) => {
        const next = new Map(prev)
        const current = next.get(itemId) ?? {
          itemId,
          actualQuantity: '',
          qualityOk: true,
          note: '',
        }
        next.set(itemId, { ...current, ...update })
        return next
      })
    },
    []
  )

  const handlePhotoCapture = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return
      setPhotos((prev) => [...prev, ...Array.from(e.target.files!)])
      e.target.value = ''
    },
    []
  )

  const removePhoto = useCallback((index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!delivery) return
    setIsSubmitting(true)
    try {
      const acceptanceItems = items.map((item) => {
        const state = getLineState(item.id)
        return {
          item_id: item.id,
          actual_quantity: state.actualQuantity ? parseFloat(state.actualQuantity) : null,
          quality_ok: state.qualityOk,
          note: state.note || undefined,
        }
      })

      await acceptDelivery({
        id: deliveryId,
        data: { items: acceptanceItems } as never,
      })

      router.push(`/deliveries/${deliveryId}`)
    } catch {
      // Error handled by mutation
    } finally {
      setIsSubmitting(false)
    }
  }, [delivery, items, getLineState, acceptDelivery, deliveryId, router])

  // ---- Loading / Error -------------------------------------------------------
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Загрузка...</span>
      </div>
    )
  }

  if (isError || !delivery) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="mt-3 text-sm text-destructive">
          {(error as Error)?.message ?? 'Поставка не найдена'}
        </p>
      </div>
    )
  }

  // ---- Render ----------------------------------------------------------------
  return (
    <div className="mx-auto max-w-lg space-y-6 pb-8">
      {/* Mobile-optimized header */}
      <PageHeader
        title="Приёмка поставки"
        description={`Поставка ${delivery.id.slice(0, 8).toUpperCase()}`}
        breadcrumbs={[
          { label: 'Поставки', href: '/deliveries' },
          { label: delivery.id.slice(0, 8).toUpperCase(), href: `/deliveries/${deliveryId}` },
          { label: 'Приёмка' },
        ]}
        actions={
          <Link
            href={`/deliveries/${deliveryId}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium transition-colors',
              'hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </Link>
        }
      />

      {/* QR Scanner placeholder */}
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
        <button
          type="button"
          onClick={() => setShowQrScanner(!showQrScanner)}
          className="flex w-full items-center justify-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <QrCode className="h-5 w-5" />
          {showQrScanner ? 'Закрыть сканер' : 'Сканировать QR-код'}
        </button>
        {showQrScanner && (
          <div className="mt-3 flex items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-800 h-48">
            <p className="text-sm text-muted-foreground">
              Камера QR-сканера (в разработке)
            </p>
          </div>
        )}
      </div>

      {/* Per-item acceptance cards */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">
          Позиции ({items.length})
        </h2>
        {items.map((item) => (
          <AcceptanceItemCard
            key={item.id}
            item={item}
            state={getLineState(item.id)}
            onChange={(update) => updateLineState(item.id, update)}
          />
        ))}
      </div>

      {/* Photo capture */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">
          Фото
        </h2>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handleFileChange}
          className="sr-only"
        />
        <button
          type="button"
          onClick={handlePhotoCapture}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-4 transition-colors',
            'hover:border-primary hover:bg-primary/5 text-sm font-medium text-muted-foreground'
          )}
        >
          <Camera className="h-5 w-5" />
          Сделать фото
        </button>
        {photos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {photos.map((photo, index) => (
              <div key={index} className="relative h-20 w-20 rounded-lg overflow-hidden border border-border">
                <img
                  src={URL.createObjectURL(photo)}
                  alt={`Фото ${index + 1}`}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Signature pad */}
      <SignaturePad onClear={() => {}} />

      {/* Submit */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmitting || isMutating}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-6 py-3 text-base font-semibold text-white transition-colors',
          'hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2',
          'disabled:pointer-events-none disabled:opacity-50'
        )}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Отправка...
          </>
        ) : (
          <>
            <CheckCircle className="h-5 w-5" />
            Подтвердить приёмку
          </>
        )}
      </button>
    </div>
  )
}
