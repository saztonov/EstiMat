import type { ColumnDef } from '../../../lib/columnPrefs';
import { createTableColumnsStore } from '../../../store/createColumnsStore';

// Столбцы реестра заказов. Служебная колонка «Действие» (act) в настройку не входит.
// «Подрядчик» без groupable: у заказа поставщику их может быть несколько, и строка не может
// принадлежать двум узлам дерева одновременно.
//
// Новый столбец можно добавлять в любое место списка: resolveColumnPrefs вставляет незнакомый
// persisted-порядку ключ следом за его соседом по defs, поэтому порядок у старых и новых
// пользователей совпадает. Поднимать version стора по-прежнему нельзя — zustand без migrate
// сбрасывает сохранённые порядок/скрытия/группировку.
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
