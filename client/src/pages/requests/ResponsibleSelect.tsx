import { Select, Tooltip } from 'antd';
import type { AssignableUser } from './types';

/**
 * Ячейка «Ответственный» свода материалов: ОДИН сотрудник на материал в рамках объекта,
 * подрядчика и вида затрат.
 *
 * Значение приходит уже разрешённым с сервера (точечное назначение → вид затрат → категория,
 * плюс активное замещение), поэтому здесь нет ни наследования, ни множественного набора —
 * компонент только показывает эффективного ответственного и отправляет новый выбор.
 *
 * Источник назначения виден в подсказке: «из справочника» читается иначе, чем назначенный вручную.
 */
interface Props {
  value: string | null;
  valueName: string | null;
  /** Откуда пришло назначение: точечное, по виду затрат или по категории. */
  source: 'material' | 'type' | 'category' | null;
  assignable: AssignableUser[];
  canAssign: boolean;
  saving?: boolean;
  onSave: (userId: string | null) => void;
}

const SOURCE_HINT: Record<'material' | 'type' | 'category', string> = {
  material: 'Назначен на этот материал',
  type: 'Унаследован от вида затрат (справочник «Закупки»)',
  category: 'Унаследован от категории затрат (справочник «Закупки»)',
};

export function ResponsibleSelect({ value, valueName, source, assignable, canAssign, saving, onSave }: Props) {
  // Только просмотр: инженер видит ответственного, но менять его может лишь руководитель.
  if (!canAssign) {
    if (!valueName) return <span style={{ color: 'var(--est-text-quaternary)' }}>не назначен</span>;
    return source ? <Tooltip title={SOURCE_HINT[source]}>{valueName}</Tooltip> : <>{valueName}</>;
  }

  // Назначенный мог стать неактивным — тогда его нет в списке кандидатов, и без этой опции
  // тег отрисовался бы как «сырой» uuid.
  const options = assignable.map((u) => ({ value: u.id, label: u.full_name }));
  if (value && valueName && !assignable.some((u) => u.id === value)) {
    options.unshift({ value, label: `${valueName} (неактивен)` });
  }

  const select = (
    <Select
      size="small"
      style={{ width: '100%', minWidth: 150 }}
      variant="borderless"
      allowClear
      showSearch
      loading={saving}
      value={value ?? undefined}
      placeholder={<span style={{ color: 'var(--est-text-quaternary)' }}>не назначен</span>}
      options={options}
      optionFilterProp="label"
      onChange={(v) => onSave(v ?? null)}
      onClick={(e) => e.stopPropagation()}
    />
  );

  return source && source !== 'material' ? <Tooltip title={SOURCE_HINT[source]}>{select}</Tooltip> : select;
}
