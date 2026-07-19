import type { ColumnDef } from '../../../lib/columnPrefs';
import { createTableColumnsStore } from '../../../store/createColumnsStore';

// Столбцы реестра РП. Служебные (непрочитанные, «№» строки, «Действия») в настройку не входят.
export const RP_REGISTRY_COLUMN_DEFS: ColumnDef[] = [
  { key: 'number', label: 'Номер' },
  { key: 'dates', label: 'Даты' },
  { key: 'order_amount', label: 'Сумма' },
  { key: 'rp_invoice_number', label: 'Номер счёта' },
  { key: 'request', label: 'Заявка' },
  { key: 'supplier', label: 'Поставщик', groupable: true },
  { key: 'contractor', label: 'Подрядчик', groupable: true },
  { key: 'rp_content', label: 'Описание' },
  { key: 'letter', label: 'Письмо' },
  { key: 'status', label: 'Статус' },
];

export const rpRegistryColumnsStore = createTableColumnsStore({
  key: 'estimat:cols:rp-registry',
  defs: RP_REGISTRY_COLUMN_DEFS,
});
