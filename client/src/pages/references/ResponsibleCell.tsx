import { Select, Tag, Tooltip } from 'antd';
import type { AssignableUser } from '../requests/types';

/**
 * Ячейка «Ответственный» справочника «Закупки»: ОДИН сотрудник на область.
 *
 * Пусто — область наследует ответственного с уровня выше (вид → категория): показываем его имя
 * серым как placeholder, чтобы «не назначено» и «наследует Иванова» не выглядели одинаково.
 * Очистка (allowClear) означает «вернуть наследование», а не «оставить без ответственного».
 *
 * Намеренно НЕ переиспользуем requests/ResponsibleSelect: там черновик набора и сохранение по
 * закрытию списка — механика, нужная только множественному выбору.
 */
interface Props {
  /** Назначенный на этом уровне (null — наследует). */
  value: string | null;
  /** Имя унаследованного ответственного — для placeholder'а. */
  inheritedName?: string | null;
  /** Активное замещение: кто и до какой даты подменяет. */
  substitute?: { name: string; endsOn: string } | null;
  assignable: AssignableUser[];
  disabled?: boolean;
  loading?: boolean;
  onChange: (userId: string | null) => void;
}

const fmtDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };

export function ResponsibleCell({
  value, inheritedName, substitute, assignable, disabled, loading, onChange,
}: Props) {
  const placeholder = inheritedName ? `наследует · ${inheritedName}` : 'не назначен';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <Select
        size="small"
        style={{ flex: 1, minWidth: 180 }}
        variant="borderless"
        allowClear
        showSearch
        disabled={disabled}
        loading={loading}
        value={value ?? undefined}
        placeholder={<span style={{ color: '#bfbfbf' }}>{placeholder}</span>}
        optionFilterProp="label"
        options={assignable.map((u) => ({
          value: u.id,
          label: u.is_active === false ? `${u.full_name} (неактивен)` : u.full_name,
        }))}
        onChange={(v) => onChange(v ?? null)}
      />
      {substitute && (
        <Tooltip title={`Замещает до ${fmtDate(substitute.endsOn)}`}>
          <Tag color="gold" style={{ margin: 0, flexShrink: 0 }}>→ {substitute.name}</Tag>
        </Tooltip>
      )}
    </div>
  );
}
