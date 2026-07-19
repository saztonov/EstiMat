import type { ColumnDef } from '../../../lib/columnPrefs';
import { createTableColumnsStore } from '../../../store/createColumnsStore';

// Столбцы реестра закупок. Служебная колонка «Действие» (act) в настройку не входит.
export const PURCHASES_REGISTRY_COLUMN_DEFS: ColumnDef[] = [
  { key: 'kind', label: 'Вид', groupable: true },
  { key: 'no', label: '№' },
  { key: 'project', label: 'Объект', groupable: true },
  { key: 'supplier', label: 'Поставщик', groupable: true },
  { key: 'amount', label: 'Сумма' },
  { key: 'status', label: 'Статус', groupable: true },
];

export const purchasesRegistryColumnsStore = createTableColumnsStore({
  key: 'estimat:cols:purchases-registry',
  defs: PURCHASES_REGISTRY_COLUMN_DEFS,
});
