'use client'

import { useEstimates, useEstimate, useEstimateItems } from '../api/queries'
import {
  useCreateEstimate,
  useUpdateEstimate,
  useApproveEstimate,
  useCreateEstimateItem,
  useUpdateEstimateItem,
  useDeleteEstimateItem,
} from '../api/mutations'
import type { UseEstimatesParams } from '../types'

/**
 * Composite hook for estimate list operations.
 *
 * Usage:
 * ```ts
 * const { list, create, update, approve } = useEstimateOperations(projectId)
 * ```
 */
export function useEstimateOperations(projectId: string, params?: UseEstimatesParams) {
  const list = useEstimates(projectId, params)
  const create = useCreateEstimate()
  const update = useUpdateEstimate()
  const approve = useApproveEstimate()

  return {
    list,
    create,
    update,
    approve,
  }
}

/**
 * Composite hook for a single estimate detail page with its items.
 */
export function useEstimateDetail(id: string) {
  const detail = useEstimate(id)
  const items = useEstimateItems(id)
  const update = useUpdateEstimate()
  const approve = useApproveEstimate()
  const createItem = useCreateEstimateItem()
  const updateItem = useUpdateEstimateItem()
  const deleteItem = useDeleteEstimateItem()

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
