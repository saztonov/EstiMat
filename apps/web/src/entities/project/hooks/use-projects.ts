'use client'

import { useState, useMemo, useCallback } from 'react'
import { useProjects } from '../api/queries'
import { useDebounce } from '@/shared/lib/use-debounce'

export function useProjectsWithSearch(defaultOrgId?: string) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [orgId, setOrgId] = useState<string | undefined>(defaultOrgId)

  const debouncedSearch = useDebounce(search, 300)

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: status || undefined,
      org_id: orgId || undefined,
    }),
    [debouncedSearch, status, orgId]
  )

  const query = useProjects(params)

  const handleSearch = useCallback((value: string) => {
    setSearch(value)
  }, [])

  const handleStatusChange = useCallback((value: string | undefined) => {
    setStatus(value)
  }, [])

  const handleOrgChange = useCallback((value: string | undefined) => {
    setOrgId(value)
  }, [])

  return {
    ...query,
    search,
    status,
    orgId,
    setSearch: handleSearch,
    setStatus: handleStatusChange,
    setOrgId: handleOrgChange,
  }
}
