import type {
  PurchaseOrder,
  PurchaseOrderWithRelations,
  PoItem,
  PoItemWithRelations,
  PurchaseOrderListParams,
  PoStatus,
} from '@estimat/shared'

// ============================================================================
// Purchase Order entity local types
// ============================================================================

export type {
  PurchaseOrder,
  PurchaseOrderWithRelations,
  PoItem,
  PoItemWithRelations,
  PurchaseOrderListParams,
}

export interface PurchaseOrderFilters extends PurchaseOrderListParams {
  sort_by?: string
  sort_direction?: 'asc' | 'desc'
}

/** Labels for PO statuses in Russian */
export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: 'Черновик',
  confirmed: 'Подтверждён',
  in_delivery: 'В доставке',
  delivered: 'Доставлен',
  closed: 'Закрыт',
  cancelled: 'Отменён',
}

/** Color variants for PO statuses */
export const PO_STATUS_COLORS: Record<PoStatus, string> = {
  draft: 'amber',
  confirmed: 'green',
  in_delivery: 'blue',
  delivered: 'green',
  closed: 'gray',
  cancelled: 'red',
}
