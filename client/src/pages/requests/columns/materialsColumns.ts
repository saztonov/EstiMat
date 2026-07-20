import type { ColumnDef } from '../../../lib/columnPrefs';
import { createTableColumnsStore } from '../../../store/createColumnsStore';

// Столбцы свода материалов. Строка = один материал в рамках объекта, подрядчика и вида затрат,
// поэтому «Заявка» и «Поставка» многозначны и уровнями дерева быть не могут: строка не
// принадлежала бы одному узлу. Уровни — объект/подрядчик/ответственный/категория.
//
// «Ед.» скрыта по умолчанию: единица измерения информативна только рядом с названием, куда она
// и переехала серым суффиксом.
export const MATERIALS_COLUMN_DEFS: ColumnDef[] = [
  { key: 'project', label: 'Объект', groupable: true },
  { key: 'contractor', label: 'Подрядчик', groupable: true },
  { key: 'resp', label: 'Ответственный', groupable: true },
  { key: 'req', label: 'Заявка' },
  { key: 'name', label: 'Материал', required: true },
  { key: 'unit', label: 'Ед.', defaultHidden: true },
  { key: 'delivery', label: 'Поставка' },
  { key: 'requested', label: 'Запрошено' },
  { key: 'remaining', label: 'Осталось заказать' },
  { key: 'category', label: 'Категория', groupable: true, defaultHidden: true },
];

export const materialsColumnsStore = createTableColumnsStore({
  key: 'estimat:cols:requests-materials',
  defs: MATERIALS_COLUMN_DEFS,
});
