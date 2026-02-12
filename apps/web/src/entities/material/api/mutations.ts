'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  MaterialCatalog,
  MaterialGroup,
  CreateMaterialInput,
  UpdateMaterialInput,
  CreateMaterialGroupInput,
} from '../types'
import { materialKeys } from './queries'

// ============================================================================
// Material mutations
// ============================================================================

export function useCreateMaterial() {
  const queryClient = useQueryClient()

  return useMutation<MaterialCatalog, Error, CreateMaterialInput>({
    mutationFn: async (data) => {
      const res = await fetch('/api/v1/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error?.message ?? 'Не удалось создать материал')
      }
      const json = await res.json()
      return json.data ?? json
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: materialKeys.all })
    },
  })
}

export function useUpdateMaterial() {
  const queryClient = useQueryClient()

  return useMutation<
    MaterialCatalog,
    Error,
    { id: string; data: UpdateMaterialInput }
  >({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/v1/materials/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(
          error?.error?.message ?? 'Не удалось обновить материал'
        )
      }
      const json = await res.json()
      return json.data ?? json
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: materialKeys.all })
      queryClient.invalidateQueries({
        queryKey: materialKeys.detail(variables.id),
      })
    },
  })
}

export function useDeleteMaterial() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/v1/materials/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(
          error?.error?.message ?? 'Не удалось удалить материал'
        )
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: materialKeys.all })
    },
  })
}

// ============================================================================
// Material group mutations
// ============================================================================

export function useCreateMaterialGroup() {
  const queryClient = useQueryClient()

  return useMutation<MaterialGroup, Error, CreateMaterialGroupInput>({
    mutationFn: async (data) => {
      const res = await fetch('/api/v1/material-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(
          error?.error?.message ?? 'Не удалось создать группу материалов'
        )
      }
      const json = await res.json()
      return json.data ?? json
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: materialKeys.groups() })
    },
  })
}

export function useUpdateMaterialGroup() {
  const queryClient = useQueryClient()

  return useMutation<
    MaterialGroup,
    Error,
    { id: string; data: Partial<CreateMaterialGroupInput> }
  >({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/v1/material-groups/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(
          error?.error?.message ?? 'Не удалось обновить группу материалов'
        )
      }
      const json = await res.json()
      return json.data ?? json
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: materialKeys.groups() })
      queryClient.invalidateQueries({
        queryKey: materialKeys.group(variables.id),
      })
      // Materials may display group info, refresh them too
      queryClient.invalidateQueries({ queryKey: materialKeys.all })
    },
  })
}

export function useDeleteMaterialGroup() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/v1/material-groups/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(
          error?.error?.message ?? 'Не удалось удалить группу материалов'
        )
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: materialKeys.groups() })
      queryClient.invalidateQueries({ queryKey: materialKeys.all })
    },
  })
}
