import type { ColumnDef } from '../../../lib/columnPrefs';
import { createTableColumnsStore } from '../../../store/createColumnsStore';

// Столбцы реестра заказов. Служебная колонка «Действие» (act) в настройку не входит.
// «Подрядчик» без groupable: у заказа поставщику их может быть несколько, и строка не может
// принадлежать двум узлам дерева одновременно.
//
// Новые столбцы дописываются В КОНЕЦ: resolveColumnPrefs добавляет незнакомый persisted-порядку
// ключ именно в конец, поэтому вставка в середину дала бы разный порядок у старых и новых
// пользователей. Поднимать version стора нельзя — zustand без migrate сбрасывает сохранённые
// порядок/скрытия/группировку.
export const PURCHASES_REGISTRY_COLUMN_DEFS: ColumnDef[] = [
  { key: 'kind', label: 'Вид', groupable: true },
  { key: 'no', label: '№' },
  { key: 'project', label: 'Объект', groupable: true },
  { key: 'supplier', label: 'Поставщик', groupable: true },
  { key: 'amount', label: 'Сумма' },
  { key: 'status', label: 'Статус', groupable: true },
  { key: 'contractor', label: 'Подрядчик' },
];

export const purchasesRegistryColumnsStore = createTableColumnsStore({
  key: 'estimat:cols:purchases-registry',
  defs: PURCHASES_REGISTRY_COLUMN_DEFS,
});
