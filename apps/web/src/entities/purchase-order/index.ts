// ============================================================================
// Purchase Order entity — public API
// ============================================================================

// API: queries
export {
  usePurchaseOrders,
  usePurchaseOrder,
  usePurchaseOrderItems,
  purchaseOrderKeys,
} from './api/queries'

// API: mutations
export {
  useCreatePurchaseOrder,
  useUpdatePurchaseOrder,
  useConfirmPurchaseOrder,
  useUpdatePurchaseOrderStatus,
  useCreatePoItem,
  useUpdatePoItem,
  useDeletePoItem,
} from './api/mutations'

// Hooks
export { usePurchaseOrderList, usePurchaseOrderDetail } from './hooks/use-purchase-orders'

// UI
export { OrderRow, OrderRowHeader } from './ui/order-row'
export { OrderStatusBadge } from './ui/order-status-badge'

// Types
export type { PurchaseOrderFilters } from './types'
export { PO_STATUS_LABELS, PO_STATUS_COLORS } from './types'
