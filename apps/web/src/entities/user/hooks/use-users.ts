'use client'

import { useState, useMemo, useCallback } from 'react'
import { useUsers } from '../api/queries'
import { useDebounce } from '@/shared/lib/use-debounce'

export function useUsersWithSearch(defaultOrgId?: string) {
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<string | undefined>(undefined)
  const [orgId, setOrgId] = useState<string | undefined>(defaultOrgId)

  const debouncedSearch = useDebounce(search, 300)

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      role: role || undefined,
      org_id: orgId || undefined,
    }),
    [debouncedSearch, role, orgId]
  )

  const query = useUsers(params)

  const handleSearch = useCallback((value: string) => {
    setSearch(value)
  }, [])

  const handleRoleChange = useCallback((value: string | undefined) => {
    setRole(value)
  }, [])

  const handleOrgChange = useCallback((value: string | undefined) => {
    setOrgId(value)
  }, [])

  return {
    ...query,
    search,
    role,
    orgId,
    setSearch: handleSearch,
    setRole: handleRoleChange,
    setOrgId: handleOrgChange,
  }
}
