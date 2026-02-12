// ============================================================================
// Delivery entity — public API
// ============================================================================

// API: queries
export {
  useDeliveries,
  useDelivery,
  useDeliveryItems,
  useAcceptanceDocs,
  deliveryKeys,
} from './api/queries'

// API: mutations
export {
  useCreateDelivery,
  useUpdateDelivery,
  useAcceptDelivery,
  useUploadAcceptanceDoc,
  useCreateTransfer,
  useCreateSale,
  useCreateWriteoff,
  useCreateClaim,
} from './api/mutations'

// Hooks
export { useDeliveryList, useDeliveryDetail } from './hooks/use-deliveries'

// UI
export { DeliveryRow, DeliveryRowHeader } from './ui/delivery-row'
export { DeliveryStatusBadge } from './ui/delivery-status-badge'

// Types
export type { DeliveryFilters } from './types'
export { DELIVERY_STATUS_LABELS, DELIVERY_STATUS_COLORS } from './types'
