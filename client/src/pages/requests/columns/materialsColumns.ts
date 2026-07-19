import type { ColumnDef } from '../../../lib/columnPrefs';
import { createTableColumnsStore } from '../../../store/createColumnsStore';

// Столбцы свода материалов. Порядок по умолчанию: объект → подрядчик → ответственный → заявка →
// материал → далее как раньше. Уровни дерева (groupable) — объект/подрядчик/ответственный/заявка/
// категория; материал — лист. «Категория» скрыта по умолчанию (доп. уровень группировки).
export const MATERIALS_COLUMN_DEFS: ColumnDef[] = [
  { key: 'project', label: 'Объект', groupable: true },
  { key: 'contractor', label: 'Подрядчик', groupable: true },
  { key: 'resp', label: 'Ответственный', groupable: true },
  { key: 'req', label: 'Заявка', groupable: true },
  { key: 'name', label: 'Материал', required: true },
  { key: 'unit', label: 'Ед.' },
  { key: 'delivery', label: 'Дата поставки' },
  { key: 'requested', label: 'Запрошено' },
  { key: 'remaining', label: 'Осталось заказать' },
  { key: 'category', label: 'Категория', groupable: true, defaultHidden: true },
];

export const materialsColumnsStore = createTableColumnsStore({
  key: 'estimat:cols:requests-materials',
  defs: MATERIALS_COLUMN_DEFS,
});
