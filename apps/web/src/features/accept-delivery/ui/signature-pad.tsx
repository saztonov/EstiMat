'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, Save } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface SignaturePadProps {
  /** Width of the canvas */
  width?: number
  /** Height of the canvas */
  height?: number
  /** Stroke color */
  strokeColor?: string
  /** Stroke width in pixels */
  strokeWidth?: number
  /** Called when signature is saved with a base64 PNG data URL */
  onSave?: (dataUrl: string) => void
  /** Whether the pad is disabled */
  disabled?: boolean
}

export function SignaturePad({
  width = 500,
  height = 200,
  strokeColor = '#000000',
  strokeWidth = 2,
  onSave,
  disabled = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)

  // Setup canvas on mount
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas dimensions accounting for device pixel ratio
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.scale(dpr, dpr)

    // Fill with white background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)

    // Configure stroke
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [width, height, strokeColor, strokeWidth])

  const getCanvasPoint = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return null

      const rect = canvas.getBoundingClientRect()
      const scaleX = width / rect.width
      const scaleY = height / rect.height

      let clientX: number
      let clientY: number

      if ('touches' in e) {
        if (e.touches.length === 0) return null
        clientX = e.touches[0].clientX
        clientY = e.touches[0].clientY
      } else {
        clientX = e.clientX
        clientY = e.clientY
      }

      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      }
    },
    [width, height]
  )

  const startDrawing = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (disabled) return
      e.preventDefault()

      const point = getCanvasPoint(e)
      if (!point) return

      setIsDrawing(true)
      setHasSignature(true)
      lastPointRef.current = point

      const ctx = canvasRef.current?.getContext('2d')
      if (ctx) {
        ctx.beginPath()
        ctx.moveTo(point.x, point.y)
      }
    },
    [disabled, getCanvasPoint]
  )

  const draw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing || disabled) return
      e.preventDefault()

      const point = getCanvasPoint(e)
      if (!point) return

      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx || !lastPointRef.current) return

      ctx.strokeStyle = strokeColor
      ctx.lineWidth = strokeWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      ctx.beginPath()
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y)
      ctx.lineTo(point.x, point.y)
      ctx.stroke()

      lastPointRef.current = point
    },
    [isDrawing, disabled, getCanvasPoint, strokeColor, strokeWidth]
  )

  const stopDrawing = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault()
      setIsDrawing(false)
      lastPointRef.current = null
    },
    []
  )

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    setHasSignature(false)
  }, [width, height])

  const saveSignature = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !hasSignature) return

    const dataUrl = canvas.toDataURL('image/png')
    onSave?.(dataUrl)
  }, [hasSignature, onSave])

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-foreground">Подпись</label>

      {/* Canvas container */}
      <div
        className={cn(
          'overflow-hidden rounded-lg border-2 border-border',
          isDrawing && 'border-primary',
          disabled && 'opacity-50'
        )}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className={cn(
            'block w-full touch-none',
            disabled ? 'cursor-not-allowed' : 'cursor-crosshair'
          )}
          style={{ height: `${height}px` }}
        />
      </div>

      {/* Hint */}
      <p className="text-xs text-muted-foreground">
        Поставьте подпись мышью или пальцем на сенсорном экране
      </p>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={clearCanvas}
          disabled={disabled || !hasSignature}
          className={cn(
            'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          <Eraser className="h-4 w-4" />
          Очистить
        </button>
        <button
          type="button"
          onClick={saveSignature}
          disabled={disabled || !hasSignature}
          className={cn(
            'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
            'hover:bg-primary/90',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          <Save className="h-4 w-4" />
          Сохранить подпись
        </button>
      </div>
    </div>
  )
}
