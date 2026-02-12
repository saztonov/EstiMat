'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Organization, CreateOrganizationInput, UpdateOrganizationInput } from '../types'
import { organizationKeys } from './queries'

export function useCreateOrganization() {
  const queryClient = useQueryClient()

  return useMutation<Organization, Error, CreateOrganizationInput>({
    mutationFn: async (data) => {
      const res = await fetch('/api/v1/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error?.message ?? 'Не удалось создать организацию')
      }
      const json = await res.json()
      return json.data ?? json
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.all })
    },
  })
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient()

  return useMutation<
    Organization,
    Error,
    { id: string; data: UpdateOrganizationInput }
  >({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/v1/organizations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error?.message ?? 'Не удалось обновить организацию')
      }
      const json = await res.json()
      return json.data ?? json
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.all })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(variables.id),
      })
    },
  })
}

export function useDeleteOrganization() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/v1/organizations/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error?.message ?? 'Не удалось удалить организацию')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.all })
    },
  })
}
