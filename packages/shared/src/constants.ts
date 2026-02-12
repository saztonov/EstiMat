// ============================================================================
// User Roles
// ============================================================================

export const USER_ROLES = [
  "admin",
  "rd_engineer",
  "estimator",
  "procurement_manager",
  "contractor",
  "supplier",
  "finance",
  "project_manager",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

// ============================================================================
// Project Statuses
// ============================================================================

export const PROJECT_STATUSES = [
  "planning",
  "active",
  "completed",
  "archived",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// ============================================================================
// Organization Types
// ============================================================================

export const ORG_TYPES = [
  "client",
  "general_contractor",
  "subcontractor",
  "supplier",
] as const;

export type OrgType = (typeof ORG_TYPES)[number];

// ============================================================================
// RD Volume Statuses (design documentation volumes)
// ============================================================================

export const RD_VOLUME_STATUSES = [
  "uploaded",
  "verified",
  "approved",
  "rejected",
] as const;

export type RdVolumeStatus = (typeof RD_VOLUME_STATUSES)[number];

// ============================================================================
// BOQ (Bill of Quantities) Statuses
// ============================================================================

export const BOQ_STATUSES = [
  "draft",
  "review",
  "approved",
  "archived",
] as const;

export type BoqStatus = (typeof BOQ_STATUSES)[number];

// ============================================================================
// Estimate Statuses
// ============================================================================

export const ESTIMATE_STATUSES = [
  "draft",
  "review",
  "approved",
  "archived",
] as const;

export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

// ============================================================================
// PR (Procurement Request) Statuses
// ============================================================================

export const PR_STATUSES = [
  "draft",
  "submitted",
  "review",
  "approved",
  "in_progress",
  "fulfilled",
  "cancelled",
] as const;

export type PrStatus = (typeof PR_STATUSES)[number];

// ============================================================================
// Funding Types
// ============================================================================

export const FUNDING_TYPES = [
  "gp_supply",
  "obs_letter",
  "advance",
] as const;

export type FundingType = (typeof FUNDING_TYPES)[number];

// ============================================================================
// PR Item Statuses
// ============================================================================

export const PR_ITEM_STATUSES = [
  "pending",
  "in_tender",
  "ordered",
  "delivered",
  "cancelled",
] as const;

export type PrItemStatus = (typeof PR_ITEM_STATUSES)[number];

// ============================================================================
// Distribution Letter Statuses
// ============================================================================

export const DIST_LETTER_STATUSES = [
  "draft",
  "rp_review",
  "rp_approved",
  "obs_review",
  "obs_approved",
  "paid",
  "cancelled",
] as const;

export type DistLetterStatus = (typeof DIST_LETTER_STATUSES)[number];

// ============================================================================
// Advance Statuses
// ============================================================================

export const ADVANCE_STATUSES = [
  "draft",
  "review",
  "approved",
  "paid",
  "cancelled",
] as const;

export type AdvanceStatus = (typeof ADVANCE_STATUSES)[number];

// ============================================================================
// Tender Types
// ============================================================================

export const TENDER_TYPES = [
  "tender",
  "non_tender",
] as const;

export type TenderType = (typeof TENDER_TYPES)[number];

// ============================================================================
// Tender Statuses
// ============================================================================

export const TENDER_STATUSES = [
  "draft",
  "published",
  "bidding",
  "evaluation",
  "awarded",
  "completed",
  "cancelled",
] as const;

export type TenderStatus = (typeof TENDER_STATUSES)[number];

// ============================================================================
// LT (Long-Term) Order Statuses
// ============================================================================

export const LT_ORDER_STATUSES = [
  "draft",
  "confirmed",
  "ordered",
  "delivered",
] as const;

export type LtOrderStatus = (typeof LT_ORDER_STATUSES)[number];

// ============================================================================
// Contract Statuses
// ============================================================================

export const CONTRACT_STATUSES = [
  "draft",
  "active",
  "expired",
  "terminated",
] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

// ============================================================================
// PO (Purchase Order) Statuses
// ============================================================================

export const PO_STATUSES = [
  "draft",
  "confirmed",
  "in_delivery",
  "delivered",
  "closed",
  "cancelled",
] as const;

export type PoStatus = (typeof PO_STATUSES)[number];

// ============================================================================
// Delivery Statuses
// ============================================================================

export const DELIVERY_STATUSES = [
  "shipped",
  "delivered",
  "accepted",
  "partially_accepted",
  "rejected",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

// ============================================================================
// Receiver Types
// ============================================================================

export const RECEIVER_TYPES = [
  "contractor",
  "brigade",
] as const;

export type ReceiverType = (typeof RECEIVER_TYPES)[number];

// ============================================================================
// Acceptance Document Types
// ============================================================================

export const ACCEPTANCE_DOC_TYPES = [
  "act",
  "photo",
  "certificate",
  "other",
] as const;

export type AcceptanceDocType = (typeof ACCEPTANCE_DOC_TYPES)[number];

// ============================================================================
// Transfer Types
// ============================================================================

export const TRANSFER_TYPES = [
  "davalcheskie",
] as const;

export type TransferType = (typeof TRANSFER_TYPES)[number];

// ============================================================================
// Transfer Statuses
// ============================================================================

export const TRANSFER_STATUSES = [
  "draft",
  "signed",
  "completed",
] as const;

export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

// ============================================================================
// Sale Statuses
// ============================================================================

export const SALE_STATUSES = [
  "draft",
  "invoiced",
  "paid",
  "cancelled",
] as const;

export type SaleStatus = (typeof SALE_STATUSES)[number];

// ============================================================================
// Write-off Statuses
// ============================================================================

export const WRITEOFF_STATUSES = [
  "draft",
  "approved",
  "completed",
] as const;

export type WriteoffStatus = (typeof WRITEOFF_STATUSES)[number];

// ============================================================================
// Claim Types
// ============================================================================

export const CLAIM_TYPES = [
  "quantity",
  "quality",
  "damage",
  "delay",
  "other",
] as const;

export type ClaimType = (typeof CLAIM_TYPES)[number];

// ============================================================================
// Claim Statuses
// ============================================================================

export const CLAIM_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "closed",
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
