'use client'

import { useVolumes, useVolume } from '../api/queries'
import {
  useCreateVolume,
  useUpdateVolume,
  useVerifyVolume,
  useApproveVolume,
} from '../api/mutations'
import type { UseVolumesParams } from '../types'

/**
 * Composite hook that bundles volume queries and mutations.
 *
 * Usage:
 * ```ts
 * const { list, create, update, verify, approve } = useVolumeOperations(projectId)
 * ```
 */
export function useVolumeOperations(projectId: string, params?: UseVolumesParams) {
  const list = useVolumes(projectId, params)
  const create = useCreateVolume()
  const update = useUpdateVolume()
  const verify = useVerifyVolume()
  const approve = useApproveVolume()

  return {
    list,
    create,
    update,
    verify,
    approve,
  }
}

/**
 * Composite hook for a single volume detail page.
 */
export function useVolumeDetail(id: string) {
  const detail = useVolume(id)
  const update = useUpdateVolume()
  const verify = useVerifyVolume()
  const approve = useApproveVolume()

  return {
    detail,
    update,
    verify,
    approve,
  }
}
