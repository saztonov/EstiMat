'use client'

import {
  useRequests,
  useRequest,
  useRequestItems,
  useDistributionLetter,
  useAdvance,
} from '../api/queries'
import {
  useCreateRequest,
  useUpdateRequest,
  useSubmitRequest,
  useApproveRequest,
  useCreateRequestItem,
  useUpdateRequestItem,
  useDeleteRequestItem,
  useApproveDistLetter,
  useApproveAdvance,
} from '../api/mutations'
import type { UseRequestsParams } from '../types'

/**
 * Composite hook for purchase request list operations.
 *
 * Usage:
 * ```ts
 * const { list, create, update, submit, approve } = useRequestOperations(projectId)
 * ```
 */
export function useRequestOperations(projectId: string, params?: UseRequestsParams) {
  const list = useRequests(projectId, params)
  const create = useCreateRequest()
  const update = useUpdateRequest()
  const submit = useSubmitRequest()
  const approve = useApproveRequest()

  return {
    list,
    create,
    update,
    submit,
    approve,
  }
}

/**
 * Composite hook for a single purchase request detail page.
 * Includes items, distribution letter, and advance sub-queries.
 */
export function useRequestDetail(id: string) {
  const detail = useRequest(id)
  const items = useRequestItems(id)
  const distLetter = useDistributionLetter(id)
  const advance = useAdvance(id)

  const update = useUpdateRequest()
  const submit = useSubmitRequest()
  const approve = useApproveRequest()
  const createItem = useCreateRequestItem()
  const updateItem = useUpdateRequestItem()
  const deleteItem = useDeleteRequestItem()
  const approveDistLetter = useApproveDistLetter()
  const approveAdvance = useApproveAdvance()

  return {
    detail,
    items,
    distLetter,
    advance,
    update,
    submit,
    approve,
    createItem,
    updateItem,
    deleteItem,
    approveDistLetter,
    approveAdvance,
  }
}
