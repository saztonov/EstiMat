import type { ColumnDef } from '../../../lib/columnPrefs';
import { createTableColumnsStore } from '../../../store/createColumnsStore';

// Столбцы реестра заказов. Служебная колонка «Действие» (act) в настройку не входит.
// «Подрядчик» без groupable: у заказа поставщику их может быть несколько, и строка не может
// принадлежать двум узлам дерева одновременно.
export const PURCHASES_REGISTRY_COLUMN_DEFS: ColumnDef[] = [
  { key: 'kind', label: 'Вид', groupable: true },
  { key: 'no', label: '№' },
  { key: 'project', label: 'Объект', groupable: true },
  { key: 'contractor', label: 'Подрядчик' },
  { key: 'supplier', label: 'Поставщик', groupable: true },
  { key: 'amount', label: 'Сумма' },
  { key: 'status', label: 'Статус', groupable: true },
];

export const purchasesRegistryColumnsStore = createTableColumnsStore({
  key: 'estimat:cols:purchases-registry',
  defs: PURCHASES_REGISTRY_COLUMN_DEFS,
});
