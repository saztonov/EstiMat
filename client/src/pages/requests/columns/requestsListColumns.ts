import type { ColumnDef } from '../../../lib/columnPrefs';
import { createTableColumnsStore } from '../../../store/createColumnsStore';

// Столбцы списка заявок. Служебные (непрочитанные, «Действие» админа) в настройку не входят.
export const REQUESTS_LIST_COLUMN_DEFS: ColumnDef[] = [
  { key: 'number', label: 'Номер' },
  { key: 'created_at', label: 'Дата' },
  { key: 'project_name', label: 'Объект', groupable: true },
  { key: 'contractor_name', label: 'Подрядчик', groupable: true },
  { key: 'request_type', label: 'Вид', groupable: true },
  { key: 'status', label: 'Статус', groupable: true },
  { key: 'supplier_name', label: 'Поставщик' },
  { key: 'order_amount', label: 'Сумма' },
  { key: 'files_count', label: 'Файлы' },
];

export const requestsListColumnsStore = createTableColumnsStore({
  key: 'estimat:cols:requests-list',
  defs: REQUESTS_LIST_COLUMN_DEFS,
});
