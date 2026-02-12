// ============================================================================
// Delivery, Delivery Item, Acceptance Doc, Material Transfer/Sale/Writeoff types
// ============================================================================

import type { BaseEntity, UUID, Timestamp } from "./common";
import type {
  DeliveryStatus,
  ReceiverType,
  AcceptanceDocType,
  TransferType,
  TransferStatus,
  SaleStatus,
  WriteoffStatus,
} from "../constants";

export interface Delivery extends BaseEntity {
  order_id: UUID;
  project_id: UUID;
  status: DeliveryStatus;
  tracking: string | null;
  expected_date: string | null;
  actual_date: string | null;
  receiver_type: ReceiverType | null;
  receiver_id: UUID | null;
  notes: string | null;
}

export interface DeliveryWithRelations extends Delivery {
  order?: {
    id: UUID;
    supplier_id: UUID;
    total: number;
  } | null;
  project?: {
    id: UUID;
    name: string;
  } | null;
  receiver?: {
    id: UUID;
    name: string;
  } | null;
  items_count?: number;
  items?: DeliveryItemWithRelations[];
  supplier?: { id: UUID; name: string } | null;
}

export interface DeliveryItem {
  id: UUID;
  delivery_id: UUID;
  po_item_id: UUID;
  shipped_qty: number;
  accepted_qty: number;
  rejected_qty: number;
  rejection_reason: string | null;
  created_at: Timestamp;
}

export interface DeliveryItemWithRelations extends DeliveryItem {
  po_item?: {
    id: UUID;
    material_id: UUID;
    quantity: number;
    unit_price: number;
  } | null;
  // Denormalized from joins
  material_name?: string;
  material_catalog_id?: UUID;
  quantity?: number;
  unit?: string;
  actual_quantity?: number;
  expected_quantity?: number;
  material?: {
    id: UUID;
    name: string;
    unit: string;
  } | null;
}

export interface AcceptanceDoc {
  id: UUID;
  delivery_id: UUID;
  type: AcceptanceDocType;
  file_path: string;
  signed_by: UUID | null;
  signed_at: Timestamp | null;
  notes: string | null;
  created_at: Timestamp;
}

export interface MaterialTransfer extends BaseEntity {
  delivery_id: UUID;
  contractor_id: UUID;
  type: TransferType;
  doc_number: string;
  doc_date: string;
  items: Record<string, unknown>[];
  signed_by: UUID | null;
  signed_at: Timestamp | null;
  status: TransferStatus;
}

export interface MaterialTransferWithRelations extends MaterialTransfer {
  contractor?: {
    id: UUID;
    name: string;
  } | null;
}

export interface MaterialSale extends BaseEntity {
  delivery_id: UUID;
  contractor_id: UUID;
  invoice_number: string | null;
  amount: number;
  status: SaleStatus;
  items: Record<string, unknown>[];
}

export interface MaterialSaleWithRelations extends MaterialSale {
  contractor?: {
    id: UUID;
    name: string;
  } | null;
}

export interface MaterialWriteoff extends BaseEntity {
  delivery_id: UUID;
  project_id: UUID;
  site_id: UUID | null;
  writeoff_date: string;
  items: Record<string, unknown>[];
  approved_by: UUID | null;
  status: WriteoffStatus;
}

export interface MaterialWriteoffWithRelations extends MaterialWriteoff {
  site?: {
    id: UUID;
    name: string;
  } | null;
}

export interface DeliveryListParams {
  order_id?: UUID;
  project_id?: UUID;
  status?: DeliveryStatus;
  receiver_type?: ReceiverType;
  page?: number;
  limit?: number;
}
