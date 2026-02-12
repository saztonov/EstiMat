'use client'

import { useBoqs, useBoq, useBoqItems } from '../api/queries'
import {
  useCreateBoq,
  useUpdateBoq,
  useApproveBoq,
  useCreateBoqItem,
  useUpdateBoqItem,
  useDeleteBoqItem,
} from '../api/mutations'
import type { UseBoqsParams } from '../types'

/**
 * Composite hook for BOQ list operations.
 *
 * Usage:
 * ```ts
 * const { list, create, update, approve } = useBoqOperations(projectId)
 * ```
 */
export function useBoqOperations(projectId: string, params?: UseBoqsParams) {
  const list = useBoqs(projectId, params)
  const create = useCreateBoq()
  const update = useUpdateBoq()
  const approve = useApproveBoq()

  return {
    list,
    create,
    update,
    approve,
  }
}

/**
 * Composite hook for a single BOQ detail page with its items.
 */
export function useBoqDetail(id: string) {
  const detail = useBoq(id)
  const items = useBoqItems(id)
  const update = useUpdateBoq()
  const approve = useApproveBoq()
  const createItem = useCreateBoqItem()
  const updateItem = useUpdateBoqItem()
  const deleteItem = useDeleteBoqItem()

  return {
    detail,
    items,
    update,
    approve,
    createItem,
    updateItem,
    deleteItem,
  }
}
