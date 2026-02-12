import type {
  Tender,
  TenderWithRelations,
  TenderLot,
  TenderLotWithRelations,
  TenderLotRequest,
  LongTermOrder,
  LongTermOrderWithRelations,
  TenderListParams,
  TenderType,
  TenderStatus,
  LtOrderStatus,
} from '@estimat/shared'

// ============================================================================
// Tender entity local types
// ============================================================================

export type {
  Tender,
  TenderWithRelations,
  TenderLot,
  TenderLotWithRelations,
  TenderLotRequest,
  LongTermOrder,
  LongTermOrderWithRelations,
  TenderListParams,
}

export interface TenderFilters extends TenderListParams {
  sort_by?: string
  sort_direction?: 'asc' | 'desc'
}

export interface LongTermOrderListParams {
  contract_id?: string
  material_id?: string
  status?: LtOrderStatus
  page?: number
  limit?: number
}

/** Labels for tender types in Russian */
export const TENDER_TYPE_LABELS: Record<TenderType, string> = {
  tender: 'Тендер',
  non_tender: 'Без тендера',
}

/** Labels for tender statuses in Russian */
export const TENDER_STATUS_LABELS: Record<TenderStatus, string> = {
  draft: 'Черновик',
  published: 'Опубликован',
  bidding: 'Сбор предложений',
  evaluation: 'Оценка',
  awarded: 'Определён победитель',
  completed: 'Завершён',
  cancelled: 'Отменён',
}

/** Color variants for tender statuses */
export const TENDER_STATUS_COLORS: Record<TenderStatus, string> = {
  draft: 'amber',
  published: 'green',
  bidding: 'blue',
  evaluation: 'amber',
  awarded: 'green',
  completed: 'gray',
  cancelled: 'red',
}

/** Labels for long-term order statuses in Russian */
export const LT_ORDER_STATUS_LABELS: Record<LtOrderStatus, string> = {
  draft: 'Черновик',
  confirmed: 'Подтверждён',
  ordered: 'Заказан',
  delivered: 'Поставлен',
}
