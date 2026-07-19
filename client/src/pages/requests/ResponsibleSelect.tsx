import { useMemo } from 'react';
import { Select, Tag } from 'antd';
import type { AssignableUser } from './types';

// Ячейка «Ответственный» свода материалов: назначить конкретного (override) или показать всех
// назначенных по категории вида работ. В списке сначала назначенные по этой категории, затем
// остальные активные внутренние пользователи. Пусто (нет override и нет категорийных) — «не назначены».

interface Props {
  /** Текущий override (assigned_responsible_id). */
  value: string | null;
  /** ФИО назначенного (assigned_responsible_name) — на случай, если его нет среди assignable (неактивен). */
  assignedName: string | null;
  /** Все ответственные по категории вида работ (для дефолтного показа). */
  categoryNames: string[];
  /** id ответственных по категории (для порядка опций). */
  categoryIds: string[];
  /** Кандидаты (/procurement/assignable-users). */
  assignable: AssignableUser[];
  /** Список кандидатов загружен — только тогда отсутствующего в нём помечаем «(неактивен)». */
  assignableReady?: boolean;
  /** Может ли пользователь назначать (внутренние роли). */
  canAssign: boolean;
  onAssign: (userId: string | null) => void;
  saving?: boolean;
}

export function ResponsibleSelect({
  value, assignedName, categoryNames, categoryIds, assignable, assignableReady, canAssign, onAssign, saving,
}: Props) {
  const options = useMemo(() => {
    const inCat = new Set(categoryIds);
    const assigned = assignable.filter((u) => inCat.has(u.id));
    const others = assignable.filter((u) => !inCat.has(u.id));
    const toOpt = (u: AssignableUser) => ({ value: u.id, label: u.full_name });
    // Назначенный, отсутствующий в списке — добавим, чтобы value отобразился. «(неактивен)»
    // помечаем только когда список ЗАГРУЖЕН (иначе активный временно казался бы неактивным).
    const extra = value && !assignable.some((u) => u.id === value)
      ? [{ label: 'Текущий', options: [{ value, label: assignableReady ? `${assignedName ?? 'выбран'} (неактивен)` : (assignedName ?? 'выбран') }] }]
      : [];
    const groups = [];
    if (assigned.length) groups.push({ label: 'По виду', options: assigned.map(toOpt) });
    if (others.length) groups.push({ label: 'Остальные', options: others.map(toOpt) });
    return [...extra, ...groups];
  }, [assignable, assignableReady, categoryIds, value, assignedName]);

  // Только просмотр (нет права назначать): текст, как раньше.
  if (!canAssign) {
    if (value) return <>{assignedName ?? '—'}</>;
    return categoryNames.length
      ? <>{categoryNames.join(', ')}</>
      : <span style={{ color: '#bfbfbf' }}>не назначены</span>;
  }

  const placeholder = categoryNames.length
    ? categoryNames.join(', ')
    : 'не назначены';

  return (
    <Select
      size="small"
      style={{ width: '100%', minWidth: 150 }}
      variant="borderless"
      allowClear
      showSearch
      loading={saving}
      value={value}
      placeholder={<span style={{ color: value ? undefined : '#8c8c8c' }}>{placeholder}</span>}
      options={options}
      optionFilterProp="label"
      filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
      onChange={(v) => onAssign(v ?? null)}
      onClick={(e) => e.stopPropagation()}
      // Override-бейдж: показываем, что тут назначен конкретный (иначе placeholder = все по категории).
      suffixIcon={value ? <Tag color="blue" style={{ marginInlineEnd: 0 }}>назн.</Tag> : undefined}
    />
  );
}
