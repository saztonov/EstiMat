'use client'

import { useState, useCallback } from 'react'
import { useCreateVolume } from '@/entities/volume'

/**
 * Hook combining form state and mutation logic for uploading a volume.
 */
export function useUploadVolume(projectId: string) {
  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const createVolume = useCreateVolume()

  const reset = useCallback(() => {
    setTitle('')
    setCode('')
    setFile(null)
    setError(null)
  }, [])

  const submit = useCallback(async () => {
    if (!title.trim()) {
      setError('Наименование тома обязательно')
      throw new Error('Наименование тома обязательно')
    }

    if (!file) {
      setError('Файл обязателен для загрузки')
      throw new Error('Файл обязателен для загрузки')
    }

    setError(null)

    try {
      const result = await createVolume.mutateAsync({
        projectId,
        title: title.trim(),
        code: code.trim() || null,
        file,
      })
      return result
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Не удалось загрузить том РД'
      setError(message)
      throw err
    }
  }, [projectId, title, code, file, createVolume])

  return {
    // Form state
    title,
    setTitle,
    code,
    setCode,
    file,
    setFile,

    // Mutation state
    isSubmitting: createVolume.isPending,
    error,

    // Actions
    reset,
    submit,
  }
}
