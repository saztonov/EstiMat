// ============================================================================
// Tender entity — public API
// ============================================================================

// API: queries
export {
  useTenders,
  useTender,
  useTenderLots,
  useLongTermOrders,
  tenderKeys,
  longTermOrderKeys,
} from './api/queries'

// API: mutations
export {
  useCreateTender,
  useUpdateTender,
  usePublishTender,
  useAwardTender,
  useCreateLongTermOrder,
  useUpdateLongTermOrder,
} from './api/mutations'

// Hooks
export { useTenderList, useTenderDetail, useLongTermOrderList } from './hooks/use-tenders'

// UI
export { TenderRow, TenderRowHeader } from './ui/tender-row'
export { TenderStatusBadge } from './ui/tender-status-badge'
export { LotCard } from './ui/lot-card'

// Types
export type { TenderFilters, LongTermOrderListParams } from './types'
export {
  TENDER_TYPE_LABELS,
  TENDER_STATUS_LABELS,
  TENDER_STATUS_COLORS,
  LT_ORDER_STATUS_LABELS,
} from './types'
