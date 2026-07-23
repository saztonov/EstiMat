import type { ColumnDef } from '../../../lib/columnPrefs';
import { createTableColumnsStore } from '../../../store/createColumnsStore';

// Столбцы вкладки «Заявки» подрядчика. «Подрядчик» есть только у внутренних ролей (условная
// колонка — applyColumnPrefs работает по фактически присутствующим). Служебные (непрочитанные,
// «Действия»/Excel) в настройку не входят.
export const CONTRACTOR_REQUESTS_COLUMN_DEFS: ColumnDef[] = [
  { key: 'number', label: 'Номер' },
  { key: 'created_at', label: 'Дата' },
  { key: 'request_type', label: 'Вид', groupable: true },
  { key: 'contractor_name', label: 'Подрядчик', groupable: true },
  // «Информация» — кнопка с поповером (договор, ВОР, местоположения и типы, шифры РД). Значения
  // нет, поэтому ни отбора, ни группировки: столбец можно только скрыть или переставить.
  { key: 'info', label: 'Информация' },
  { key: 'status', label: 'Статус', groupable: true },
  { key: 'order_amount', label: 'Сумма' },
  // Шифры РД — набор, а не скаляр: уровнем дерева быть не может, поэтому без groupable.
  { key: 'rd_ciphers', label: 'Шифры РД' },
];

export const contractorRequestsColumnsStore = createTableColumnsStore({
  key: 'estimat:cols:contractor-requests',
  defs: CONTRACTOR_REQUESTS_COLUMN_DEFS,
});
