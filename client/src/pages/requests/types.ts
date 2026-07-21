import type {
  RequestStatus, RecognitionStatus, InvoiceMatchResult, InvoiceMatchStatus,
} from '@estimat/shared';

export interface RequestItem {
  id: string;
  name: string;
  unit: string;
  quantity: number | string;
  cost_type_name: string | null;
  agg_key: string;
  /** Дата поставки строки (график СУ-10); null — материал без графика. */
  delivery_date: string | null;
  /** Сколько этой позиции уже размещено в активных заказах поставщику. */
  placed?: number | string;
  /** Объём на момент ПЕРВОЙ правки снабжением (null — объём не менялся). */
  quantity_original?: number | string | null;
  quantity_changed_at?: string | null;
  quantity_changed_by_name?: string | null;
}

export interface RequestFile {
  id: string;
  doc_type: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
  created_by_name: string | null;
  created_by_role: string | null;
  is_rejected: boolean;
  rejected_by_name: string | null;
  rejected_at: string | null;
}

export interface RequestOrder {
  id: string;
  supplier_id: string | null;
  supplier_name: string;
  supplier_inn: string | null;
  amount: string | number;
  rp_number: string | null;
  rp_date: string | null;
  delivery_days: number | null;
  delivery_days_type: string | null;
  shipping_conditions: string | null;
  rp_comment: string | null;
  created_at: string;
}

export interface RequestPayment {
  id: string;
  amount: string | number;
  paid_at: string | null;
  doc_number: string | null;
  comment: string | null;
  reversed?: boolean;
  created_at: string;
}

export interface RpLetterInfo {
  payhub_reg_number: string | null;
  payhub_url: string | null;
  payhub_status: string | null;
  sync_status: string;
  sent_at: string | null;
  last_error: string | null;
}

export interface RequestRevision {
  id: string;
  reason: string;
  response: string | null;
  requested_at: string;
  completed_at: string | null;
  requested_by_name: string | null;
  completed_by_name: string | null;
}

export interface RequestHistoryEntry {
  action: string;
  changes: Record<string, unknown> | null;
  created_at: string;
  actor_name: string | null;
}

export interface RequestRow {
  id: string;
  number: string;
  request_no: number | null;
  request_type: string;
  status: RequestStatus;
  created_at: string;
  row_version: number;
  contractor_name: string | null;
  contractor_inn: string | null;
  /** Кто завёл заявку: подрядчик или сотрудник от его имени. Владелец — всегда contractor_name. */
  created_by_name: string | null;
  project_name: string | null;
  project_code: string | null;
  supplier_name: string | null;
  supplier_inn: string | null;
  order_amount: string | number | null;
  order_paid_amount: string | number | null;
  rp_number: string | null;
  rp_date: string | null;
  payhub_reg_number: string | null;
  payhub_url: string | null;
  payhub_letter_id: string | null;
  rp_sync_status: string | null;
  rp_subject: string | null;
  rp_content: string | null;
  rp_responsible_name: string | null;
  rp_invoice_number: string | null;
  rp_sent_date: string | null;
  rp_letter_date: string | null;
  rp_created_at: string | null;
  rp_author: string | null;
  recipient_name: string | null;
  files_count: number | string;
  items_count: number | string;
  revision_reason: string | null;
  /** Материалы заявки в лоте, ушедшем в закупку (sourcing/awarded/cancel_pending). */
  in_active_purchase: boolean;
  /** Шифры РД всех видов работ заявки (объединение, отсортировано по коду). */
  rd_ciphers: string[];
}

// Данные для формы «Отправить РП» (GET /requests/:id/rp-config).
export interface RpConfig {
  project: { code: string | null; name: string | null } | null;
  sender: { name: string | null; inn: string | null } | null;
  recipient: { name: string | null; inn: string | null } | null;
  mapped: boolean;
  defaultSubject: string;
  defaultContent: string;
  responsibleName: string | null;
}

export interface RequestDetail extends RequestRow {
  estimate_label: string | null;
  items: RequestItem[];
  files: RequestFile[];
  order: RequestOrder | null;
  payments: RequestPayment[];
  revisions: RequestRevision[];
  history: RequestHistoryEntry[];
  rp_letter: RpLetterInfo | null;
}

// ===== Закупочные лоты СУ-10 =====

// Строка свода материалов (исходная позиция заявки). Для su10 — 1:1 с формированием лота;
// у прочих видов размещение не применяется (ordered/remaining = null).
/**
 * Строка свода «Материалы» — ОДИН материал в рамках объекта, подрядчика и вида затрат.
 * Исходные позиции заявок развёрнуты по датам поставки, поэтому под строкой их несколько
 * (items); столбцы «Заявка» и «Поставка» из-за этого многозначны.
 */
export interface Su10MaterialGroupRow {
  /** Ключ области — он же rowKey таблицы (заменил request_item_id). */
  row_key: string;
  /** Исходные позиции заявок под строкой: даты поставки и их количества. */
  items: {
    request_item_id: string;
    request_id: string;
    request_no: number | null;
    delivery_date: string | null;
    requested: string | number;
    placed: string | number;
  }[];
  /** Заявки, из которых собрана строка (для столбца «Заявка»). */
  requests: { id: string; no: number | null }[];
  request_type: string;
  status: string;
  project_id: string | null;
  project_name: string | null;
  project_code: string | null;
  cost_type_id: string | null;
  cost_type_name: string | null;
  category_id: string | null;
  category_name: string | null;
  category_sort: number | null;
  cost_type_sort: number | null;
  material_id: string | null;
  material_name: string;
  unit: string;
  agg_key: string;
  requested: string | number;
  ordered: number | null;
  /** Сколько ещё можно заказать (сумма положительных остатков позиций). */
  remaining: number | null;
  /** Сколько заказано сверх заявленного — следствие правки объёмов после формирования заказа. */
  overplaced: number;
  has_overplaced: boolean;
  contractor_id: string | null;
  contractor_name: string | null;
  /** Право вести заказ по этой области — считает сервер тем же правилом, что и при создании. */
  can_order: boolean;
  /** Эффективный ответственный: точечный → вид → категория, с учётом замещения. */
  responsible: { id: string; full_name: string | null; source: 'material' | 'type' | 'category' | null } | null;
}

/** @deprecated Строка-позиция (до схлопывания по датам). Используется модалками заказа и тендера. */
export interface Su10MaterialRow {
  request_item_id: string;
  request_id: string;
  request_no: number | null;
  request_type: string;
  status: string;
  project_id: string | null;
  project_name: string | null;
  project_code: string | null;
  cost_type_id: string | null;
  cost_type_name: string | null;
  category_id: string | null;
  category_name: string | null;
  category_sort: number | null;
  cost_type_sort: number | null;
  material_id: string | null;
  material_name: string;
  unit: string;
  agg_key: string;
  /** Дата поставки строки (график СУ-10); null — без графика. */
  delivery_date: string | null;
  requested: string | number;
  ordered: number | null;
  remaining: number | null;
  contractor_id: string | null;
  contractor_name: string | null;
  /** Назначенные ответственные за строку (override). Пусто — показываются все по категории. */
  assigned_responsibles: { id: string; full_name: string }[];
  /** @deprecated Первый из набора — только для совместимости; используйте assigned_responsibles. */
  assigned_responsible_id?: string | null;
  /** @deprecated */
  assigned_responsible_name?: string | null;
}

// Кандидат в ответственные (GET /procurement/assignable-users).
// is_active приходит с сервера: в списке есть и деактивированные сотрудники, у которых остались
// назначения, — иначе их нельзя было бы найти, чтобы снять область.
export interface AssignableUser {
  id: string;
  full_name: string;
  role: string;
  is_active?: boolean;
}

// Опции фильтров свода материалов (facets — по всему набору, независимо от текущих фильтров).
export interface MaterialsFacets {
  projects: { id: string; name: string | null; code: string | null }[];
  contractors: { id: string; name: string | null }[];
  categories: { id: string; name: string | null }[];
}

// Вид затрат в дереве справочника «Закупки».
export interface CostTypeResponsibleNode {
  id: string;
  name: string;
  code: string | null;
  sort_order: number;
  is_active: boolean;
  /** Назначенный на самом виде (null — наследует от категории). */
  responsible_id: string | null;
  responsible_name: string | null;
  /** Эффективный с учётом наследования и замещения — то, что реально действует. */
  effective_user_id: string | null;
  effective_name: string | null;
  source: 'type' | 'category' | null;
  eff_substitution_id: string | null;
}

// Категория затрат с видами (GET /procurement/responsibles).
export interface CategoryResponsibles {
  id: string; // category_id
  name: string;
  code: string | null;
  sort_order: number;
  is_active: boolean;
  responsible_id: string | null;
  responsible_name: string | null;
  substitution_id: string | null;
  substitute_name: string | null;
  substitution_ends_on: string | null;
  types: CostTypeResponsibleNode[];
  /** @deprecated Модель «много ответственных»; 0 или 1 элемент — для незакрытых старых вкладок. */
  responsibles: { id: string; full_name: string; role?: string; is_active?: boolean }[];
}

// Назначения сотрудника (GET /procurement/responsibles/by-user/:id).
export interface UserAssignments {
  categories: { id: string; name: string }[];
  costTypes: { id: string; name: string; category_id: string; category_name: string | null }[];
  materials: {
    id: string; agg_key: string; material_name: string | null;
    project_name: string | null; contractor_name: string | null; cost_type_name: string | null;
  }[];
  substitutions: ProcurementSubstitution[];
}

// Замещение ответственного на период (справочник «Закупки»).
export interface ProcurementSubstitution {
  id: string;
  principal_user_id: string;
  deputy_user_id: string;
  principal_name: string | null;
  deputy_name: string | null;
  starts_on: string;
  ends_on: string;
  ended_at: string | null;
  reason: string | null;
  is_active: boolean;
}

export interface SupplierLotRow {
  id: string;
  order_no: number | null;
  title: string | null;
  project_id: string | null;
  project_name: string | null;
  sourcing_status: string;
  procurement_method: string | null;
  supplier_name: string | null;
  supplier_inn: string | null;
  amount: string | number | null;
  tender_status: string | null;
  tender_url: string | null;
  tender_sync_status: string | null;
  awarded_at: string | null;
  created_at: string;
  row_version: number;
  items_count: number | string;
  requests_count: number | string;
}

export interface SupplierLotItem {
  id: string;
  request_id: string | null;
  request_item_id: string | null;
  material_id: string | null;
  material_name: string;
  unit: string;
  quantity: string | number;
  /** Ключ материала: по нему ведётся график поставок и считается дозаказ в существующий заказ. */
  agg_key: string;
  contractor_id: string | null;
  contractor_name: string | null;
  request_no: number | null;
  cost_type_name: string | null;
  cost_category_name: string | null;
  /** Дата поставки (снимок из графика заявки); null — без графика. */
  delivery_date: string | null;
}

export interface SupplierLotSource {
  request_id: string;
  request_no: number | null;
  contractor_name: string | null;
  status: string;
}

export interface SupplierLotOffer {
  id: string;
  supplier_id: string | null;
  supplier_name: string;
  supplier_inn: string | null;
  amount: string | number;
  currency: string;
  terms: string | null;
  note: string | null;
  file_id: string | null;
  submitted_at: string | null;
  created_at: string;
}

export interface TenderResults {
  tender_id?: string;
  status?: string;
  outcome?: 'pending' | 'awarded' | 'no_award' | null;
  participants?: { id: string; name: string; inn?: string | null }[];
  bids?: { participant_id: string; bid_id?: string | null; amount: string | number; currency?: string | null }[];
  winner?: { participant_id: string; bid_id?: string | null; bid_index?: number | null } | null;
  finished_at?: string | null;
}

export interface SupplierLotDetail extends SupplierLotRow {
  tender_results: TenderResults | null;
  tender_last_error: string | null;
  tender_deadline_at: string | null;
  items: SupplierLotItem[];
  sources: SupplierLotSource[];
  offers: SupplierLotOffer[];
}

// ===== Заказ поставщику: оформление в одном окне =====

// Поставщик-предложение (список всех, кому отправлен запрос). Документ (КП/счёт) — на строке.
export interface OrderOffer {
  id: string;
  supplier_id: string | null;
  supplier_name: string;
  supplier_inn: string | null;
  amount: string | number | null;
  currency: string;
  response_status: 'pending' | 'received' | 'no_response';
  document_type: 'quote' | 'invoice' | null;
  terms: string | null;
  note: string | null;
  has_file: boolean;
  file_name: string | null;
  created_at: string;
}

// Агрегат материала заказа (по agg_key) — финансовая строка оформления победителя.
export interface OrderAggItem {
  agg_key: string;
  material_name: string;
  unit: string;
  quantity: string | number;
  cost_category_name: string | null;
}

// Цена победителя по агрегату.
export interface OrderPriceLine {
  agg_key: string;
  unit_price: string | number;
  warranty_months: number | null;
}

/**
 * Счёт заказа — платёжный документ выбранного поставщика. Их несколько: правка состава или смена
 * поставщика требуют нового счёта, а прежний не удаляется, а замещается (superseded_at).
 */
export interface OrderInvoice {
  id: string;
  /** Ревизия заказа, под которую счёт выставлен. */
  invoice_revision: number;
  invoice_no: string | null;
  /** YYYY-MM-DD. */
  invoice_date: string | null;
  amount: string | number | null;
  vat_amount: string | number | null;
  supplier_name: string | null;
  supplier_inn: string | null;
  /** 'manual' — введено руками, 'llm' — распознано, 'llm_edited' — распознано и выверено. */
  source: 'manual' | 'llm' | 'llm_edited';
  file_name: string | null;
  file_size: number | string | null;
  note: string | null;
  superseded_at: string | null;
  superseded_reason: 'composition_changed' | 'award_revoked' | 'replaced' | null;
  created_at: string;
  uploaded_by_name: string | null;
  /** Ход распознавания реквизитов моделью. 'unsupported' — формат или настройка не позволяют. */
  recognition_status: RecognitionStatus;
  recognition_error: string | null;
  /** Результат сверки с заказом. Предупреждает, но ничего не блокирует. */
  match_result: InvoiceMatchResult | null;
  match_status: InvoiceMatchStatus | null;
}

// Строка графика поставки заказа (по агрегату материала). delivery_date — YYYY-MM-DD.
export interface OrderDeliveryEntry {
  agg_key: string;
  delivery_date: string;
  quantity: string | number;
}

// Карточка заказа поставщику (GET /supplier-orders/:id).
export interface SupplierOrderDetail extends SupplierLotRow {
  vat_rate: string | null;
  payment_type: string | null;
  award_source: string | null;
  awarded_quote_id: string | null;
  procurement_method: string | null;
  tender_results: TenderResults | null;
  tender_last_error: string | null;
  tender_sync_status: string | null;
  tender_deadline_at: string | null;
  /** Согласование поставщика: кто отправил предложение и когда. */
  approval_requested_at: string | null;
  approval_requested_by: string | null;
  approval_requested_by_name: string | null;
  /** Кто подтвердил (или NULL, если решение ещё не принято либо было отклонение). */
  approved_at: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  /** Комментарий решения: при отклонении — что исправить, при подтверждении — необязателен. */
  approval_comment: string | null;
  /** Выбранное предложение до присуждения; при отклонении сохраняется. */
  proposed_offer_id: string | null;
  /** Заметка снабжения о заказе. Не входит в закупочный контракт — правится отдельным запросом. */
  comment: string | null;
  /** Растёт при каждом изменении, требующем нового счёта (правка состава, смена поставщика). */
  invoice_revision: number;
  /** Присуждённый заказ изменился, а счёт под новую ревизию ещё не приложен. */
  needs_new_invoice: boolean;
  items: SupplierLotItem[];
  aggItems: OrderAggItem[];
  sources: SupplierLotSource[];
  offers: OrderOffer[];
  priceLines: OrderPriceLine[];
  deliverySchedule: OrderDeliveryEntry[];
  invoices: OrderInvoice[];
}

// Строка единого реестра «Заказы».
export interface RegistryRow {
  kind_tag: 'supplier_order' | 'tender' | 'rp_order' | 'direct_order';
  id: string;
  link_kind: 'order' | 'request';
  project_id: string | null;
  project_name: string | null;
  number: string;
  supplier_name: string | null;
  /** Подрядчики заказа: у заказа поставщику их может быть несколько (позиции из разных заявок). */
  contractors: string[];
  amount: string | number | null;
  status: string;
  tender_status: string | null;
  tender_url: string | null;
  created_at: string;
  created_by: string | null;
}
