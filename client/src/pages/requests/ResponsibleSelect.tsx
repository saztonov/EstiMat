import { useEffect, useMemo, useState } from 'react';
import { Select } from 'antd';
import type { AssignableUser } from './types';

// Ячейка «Ответственный» свода материалов: назначить нескольких ответственных (override) либо
// показать всех по категории вида работ. В списке сначала назначенные по этой категории, затем
// остальные активные внутренние пользователи. Пусто (нет override и нет категорийных) — «не назначены».
//
// Изменения набора накапливаются в локальном черновике и сохраняются ОДНИМ запросом по закрытию
// выпадающего списка (устраняет гонки параллельных сохранений при быстром выборе нескольких).
// Удаление тега/очистка при закрытом списке сохраняется сразу (одно действие — один запрос).

interface Props {
  /** Текущие назначенные (id). */
  value: string[];
  /** Назначенные пользователи (id + ФИО) — чтобы отрисовать теги даже для отсутствующих в assignable (неактивных). */
  assignedUsers: { id: string; full_name: string }[];
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
  onSave: (userIds: string[]) => void;
  saving?: boolean;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function ResponsibleSelect({
  value, assignedUsers, categoryNames, categoryIds, assignable, assignableReady, canAssign, onSave, saving,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  // Пока список закрыт — держим черновик синхронным с внешним значением (после сохранения/рефетча).
  useEffect(() => { if (!open) setDraft(value); }, [value, open]);

  const options = useMemo(() => {
    const inCat = new Set(categoryIds);
    const assignedInCat = assignable.filter((u) => inCat.has(u.id));
    const others = assignable.filter((u) => !inCat.has(u.id));
    const assignableIds = new Set(assignable.map((u) => u.id));
    const toOpt = (u: { id: string; full_name: string }) => ({ value: u.id, label: u.full_name });
    // Назначенные, отсутствующие в списке кандидатов (неактивные) — добавим, чтобы тег отобразился.
    const missing = assignedUsers.filter((u) => !assignableIds.has(u.id));
    const groups = [];
    if (missing.length) {
      groups.push({
        label: 'Текущие',
        options: missing.map((u) => ({ value: u.id, label: assignableReady ? `${u.full_name} (неактивен)` : u.full_name })),
      });
    }
    if (assignedInCat.length) groups.push({ label: 'По виду', options: assignedInCat.map(toOpt) });
    if (others.length) groups.push({ label: 'Остальные', options: others.map(toOpt) });
    return groups;
  }, [assignable, assignableReady, categoryIds, assignedUsers]);

  // Только просмотр (нет права назначать): текст.
  if (!canAssign) {
    if (assignedUsers.length) return <>{assignedUsers.map((u) => u.full_name).join(', ')}</>;
    return categoryNames.length
      ? <>{categoryNames.join(', ')}</>
      : <span style={{ color: '#bfbfbf' }}>не назначены</span>;
  }

  const placeholder = categoryNames.length ? categoryNames.join(', ') : 'не назначены';

  return (
    <Select
      mode="multiple"
      size="small"
      style={{ width: '100%', minWidth: 150 }}
      variant="borderless"
      allowClear
      showSearch
      loading={saving}
      maxTagCount="responsive"
      value={draft}
      placeholder={<span style={{ color: '#8c8c8c' }}>{placeholder}</span>}
      options={options}
      optionFilterProp="label"
      filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
      onChange={(vals: string[]) => {
        setDraft(vals);
        // Удаление тега / очистка при закрытом списке — сохраняем сразу (одно действие — один запрос).
        if (!open && !sameSet(vals, value)) onSave(vals);
      }}
      open={open}
      onDropdownVisibleChange={(o) => {
        setOpen(o);
        if (o) setDraft(value);
        else if (!sameSet(draft, value)) onSave(draft); // накопленный набор — одним запросом
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
