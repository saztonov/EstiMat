'use client'

import { useCallback, useState } from 'react'
import { Camera, X, Loader2, ImageIcon } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { createClient } from '@/shared/lib/supabase/client'

interface PhotoCaptureProps {
  /** Supabase Storage bucket name */
  bucket?: string
  /** Folder path within the bucket */
  folder?: string
  /** Called when photos are uploaded with their public URLs */
  onPhotosUploaded?: (urls: string[]) => void
  /** Maximum number of photos */
  maxPhotos?: number
  /** Whether the component is disabled */
  disabled?: boolean
}

interface PhotoPreview {
  id: string
  file: File
  previewUrl: string
  uploadedUrl?: string
  uploading: boolean
  error?: string
}

export function PhotoCapture({
  bucket = 'acceptance-photos',
  folder = 'delivery',
  onPhotosUploaded,
  maxPhotos = 10,
  disabled = false,
}: PhotoCaptureProps) {
  const [photos, setPhotos] = useState<PhotoPreview[]>([])

  const uploadPhoto = useCallback(
    async (photo: PhotoPreview) => {
      const supabase = createClient()
      const ext = photo.file.name.split('.').pop() ?? 'jpg'
      const fileName = `${folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`

      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(fileName, photo.file, {
          contentType: photo.file.type,
          cacheControl: '3600',
        })

      if (error) {
        throw new Error(error.message)
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from(bucket).getPublicUrl(data.path)

      return publicUrl
    },
    [bucket, folder]
  )

  const handleFilesSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled || !e.target.files) return

      const files = Array.from(e.target.files)
      const remainingSlots = maxPhotos - photos.length
      const filesToAdd = files.slice(0, remainingSlots)

      if (filesToAdd.length === 0) return

      const newPhotos: PhotoPreview[] = filesToAdd.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        uploading: true,
      }))

      setPhotos((prev) => [...prev, ...newPhotos])

      // Upload each photo
      const uploadedUrls: string[] = []

      for (const photo of newPhotos) {
        try {
          const url = await uploadPhoto(photo)
          uploadedUrls.push(url)

          setPhotos((prev) =>
            prev.map((p) =>
              p.id === photo.id
                ? { ...p, uploadedUrl: url, uploading: false }
                : p
            )
          )
        } catch (err) {
          setPhotos((prev) =>
            prev.map((p) =>
              p.id === photo.id
                ? {
                    ...p,
                    uploading: false,
                    error:
                      err instanceof Error
                        ? err.message
                        : 'Ошибка загрузки',
                  }
                : p
            )
          )
        }
      }

      if (uploadedUrls.length > 0) {
        const allUploadedUrls = [
          ...photos
            .filter((p) => p.uploadedUrl)
            .map((p) => p.uploadedUrl!),
          ...uploadedUrls,
        ]
        onPhotosUploaded?.(allUploadedUrls)
      }

      // Reset input for re-selection
      e.target.value = ''
    },
    [disabled, maxPhotos, photos, uploadPhoto, onPhotosUploaded]
  )

  const removePhoto = useCallback(
    (id: string) => {
      setPhotos((prev) => {
        const updated = prev.filter((p) => p.id !== id)
        const remaining = prev.find((p) => p.id === id)

        // Revoke object URL to prevent memory leak
        if (remaining) {
          URL.revokeObjectURL(remaining.previewUrl)
        }

        // Notify parent of remaining uploaded URLs
        const uploadedUrls = updated
          .filter((p) => p.uploadedUrl)
          .map((p) => p.uploadedUrl!)
        onPhotosUploaded?.(uploadedUrls)

        return updated
      })
    },
    [onPhotosUploaded]
  )

  const canAddMore = photos.length < maxPhotos

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">
          Фото приёмки
        </label>
        <span className="text-xs text-muted-foreground">
          {photos.length} / {maxPhotos}
        </span>
      </div>

      {/* Photo grid */}
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="relative aspect-square overflow-hidden rounded-lg border border-border"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.previewUrl}
              alt="Фото приёмки"
              className="h-full w-full object-cover"
            />

            {/* Uploading overlay */}
            {photo.uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 className="h-5 w-5 animate-spin text-white" />
              </div>
            )}

            {/* Error overlay */}
            {photo.error && (
              <div className="absolute inset-0 flex items-center justify-center bg-red-500/40">
                <span className="px-1 text-center text-xs text-white">
                  {photo.error}
                </span>
              </div>
            )}

            {/* Remove button */}
            {!photo.uploading && (
              <button
                type="button"
                onClick={() => removePhoto(photo.id)}
                disabled={disabled}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white transition-colors hover:bg-black/80"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}

        {/* Add photo button */}
        {canAddMore && (
          <label
            className={cn(
              'flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 transition-colors',
              'hover:border-primary/50 hover:bg-muted/50',
              disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            <Camera className="h-6 w-6 text-muted-foreground" />
            <span className="mt-1 text-xs text-muted-foreground">Фото</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handleFilesSelected}
              disabled={disabled}
              className="sr-only"
            />
          </label>
        )}
      </div>

      {photos.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-6">
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            Сделайте фото или выберите из галереи
          </p>
        </div>
      )}
    </div>
  )
}
