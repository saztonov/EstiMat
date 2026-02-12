import type {
  Delivery,
  DeliveryWithRelations,
  DeliveryItem,
  DeliveryItemWithRelations,
  AcceptanceDoc,
  MaterialTransfer,
  MaterialSale,
  MaterialWriteoff,
  DeliveryListParams,
  DeliveryStatus,
} from '@estimat/shared'

// ============================================================================
// Delivery entity local types
// ============================================================================

export type {
  Delivery,
  DeliveryWithRelations,
  DeliveryItem,
  DeliveryItemWithRelations,
  AcceptanceDoc,
  MaterialTransfer,
  MaterialSale,
  MaterialWriteoff,
  DeliveryListParams,
}

export interface DeliveryFilters extends DeliveryListParams {
  sort_by?: string
  sort_direction?: 'asc' | 'desc'
}

/** Labels for delivery statuses in Russian */
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  shipped: 'Отгружена',
  delivered: 'Доставлена',
  accepted: 'Принята',
  partially_accepted: 'Частично принята',
  rejected: 'Отклонена',
}

/** Color variants for delivery statuses */
export const DELIVERY_STATUS_COLORS: Record<DeliveryStatus, string> = {
  shipped: 'blue',
  delivered: 'green',
  accepted: 'green',
  partially_accepted: 'amber',
  rejected: 'red',
}
