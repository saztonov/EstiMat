// ============================================================================
// Purchase Order and PO Item types
// ============================================================================

import type { BaseEntity, UUID, Timestamp } from "./common";
import type { PoStatus } from "../constants";

export interface PurchaseOrder extends BaseEntity {
  contract_id: UUID | null;
  tender_id: UUID | null;
  long_term_order_id: UUID | null;
  supplier_id: UUID;
  project_id: UUID;
  status: PoStatus;
  total: number;
  payment_terms: string | null;
  delivery_date: string | null;
  notes: string | null;
  created_by: UUID;
}

export interface PurchaseOrderWithRelations extends PurchaseOrder {
  supplier?: {
    id: UUID;
    name: string;
  } | null;
  project?: {
    id: UUID;
    name: string;
  } | null;
  contract?: {
    id: UUID;
    number: string;
  } | null;
  creator?: {
    id: UUID;
    full_name: string;
  } | null;
  items_count?: number;
  confirmed_at?: string | null;
}

export interface PoItem {
  id: UUID;
  order_id: UUID;
  material_id: UUID;
  lot_id: UUID | null;
  quantity: number;
  unit_price: number;
  /** Computed: quantity * unit_price */
  total: number;
  created_at: Timestamp;
}

export interface PoItemWithRelations extends PoItem {
  material?: {
    id: UUID;
    name: string;
    unit: string;
  } | null;
  unit?: string;
}

export interface PurchaseOrderListParams {
  supplier_id?: UUID;
  project_id?: UUID;
  contract_id?: UUID;
  status?: PoStatus;
  page?: number;
  limit?: number;
}
