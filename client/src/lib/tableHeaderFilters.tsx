import { useEffect, useState } from 'react';
import { Button, Checkbox, DatePicker, Divider, Input, InputNumber, Space } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import type { FilterDropdownProps } from 'antd/es/table/interface';
import dayjs from 'dayjs';
import {
  collectMultiOptions,
  isColumnFilterActive,
  type ColumnFilterSpec,
  type ColumnFilterValue,
} from './columnFilters';

// Меню заголовка столбца: отбор (текст / множественный выбор / диапазон дат / мин-макс) и
// переключатель «Группировать» для groupable-столбцов — всё в одном дропдауне за иконкой
// воронки. Значения отборов живут в state компонента таблицы (не сохраняются), применение —
// applyColumnFilters по полному набору (режим all=1).

interface HeaderFilterArgs<T> {
  spec: ColumnFilterSpec<T>;
  value?: ColumnFilterValue;
  onChange: (v: ColumnFilterValue | undefined) => void;
  /** Строки для сбора вариантов multi-отбора (полный загруженный набор). */
  rows: T[];
  /** Переключатель «Группировать» (только для groupable-столбцов). */
  group?: { active: boolean; onToggle: (on: boolean) => void };
}

function TextFilter({ value, onApply, close }: {
  value?: ColumnFilterValue;
  onApply: (v: ColumnFilterValue | undefined) => void;
  close: () => void;
}) {
  const outer = value?.kind === 'text' ? value.value : '';
  const [draft, setDraft] = useState(outer);
  useEffect(() => setDraft(outer), [outer]);
  const apply = () => { onApply(draft.trim() ? { kind: 'text', value: draft } : undefined); close(); };
  return (
    <>
      <Input
        autoFocus allowClear placeholder="Поиск" value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onPressEnter={apply}
        style={{ marginBottom: 8, display: 'block', width: 200 }}
      />
      <Space>
        <Button type="primary" size="small" onClick={apply}>ОК</Button>
        <Button size="small" onClick={() => { setDraft(''); onApply(undefined); close(); }}>Сброс</Button>
      </Space>
    </>
  );
}

/** Потолок рендера вариантов: список ФИО или материалов бывает в тысячи строк. */
const MULTI_RENDER_CAP = 200;

function MultiFilter({ value, options, onApply, close }: {
  value?: ColumnFilterValue;
  options: { value: string; label: string }[];
  onApply: (v: ColumnFilterValue | undefined) => void;
  close: () => void;
}) {
  const outer = value?.kind === 'multi' ? value.values : [];
  const [draft, setDraft] = useState<string[]>(outer);
  const [q, setQ] = useState('');
  useEffect(() => setDraft(outer), [outer.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Поиск фильтрует ПОЛНЫЙ список, и только результат урезается до потолка рендера: усечение
  // до фильтрации прятало бы совпадения, ради которых поиск и нужен.
  const needle = q.trim().toLowerCase();
  const matched = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const shown = matched.slice(0, MULTI_RENDER_CAP);

  // ОК отдаёт ВЕСЬ draft, включая скрытые поиском отметки: иначе ввод в поиске молча снимал бы
  // ранее выбранные значения.
  const apply = () => { onApply(draft.length ? { kind: 'multi', values: draft } : undefined); close(); };
  const toggleVisible = (on: boolean) => setDraft((d) => (on
    ? [...new Set([...d, ...matched.map((o) => o.value)])]
    : d.filter((v) => !matched.some((o) => o.value === v))));

  return (
    <>
      {options.length > 8 && (
        <Input
          allowClear size="small" placeholder="Поиск" value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ marginBottom: 6, width: 220 }}
        />
      )}
      <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
        {shown.map((o) => (
          <Checkbox
            key={o.value}
            checked={draft.includes(o.value)}
            onChange={(e) =>
              setDraft((d) => (e.target.checked ? [...d, o.value] : d.filter((v) => v !== o.value)))
            }
          >
            {o.label}
          </Checkbox>
        ))}
        {matched.length === 0 && <span style={{ color: 'var(--est-text-quaternary)' }}>Ничего не найдено</span>}
        {matched.length > MULTI_RENDER_CAP && (
          <span style={{ color: 'var(--est-text-quaternary)', fontSize: 12 }}>
            Показаны первые {MULTI_RENDER_CAP} из {matched.length} — уточните поиск
          </span>
        )}
      </div>
      <Space>
        <Button type="primary" size="small" onClick={apply}>ОК</Button>
        <Button size="small" onClick={() => { setDraft([]); setQ(''); onApply(undefined); close(); }}>Сброс</Button>
        {matched.length > 1 && (
          <>
            <Button type="link" size="small" onClick={() => toggleVisible(true)}>Все</Button>
            <Button type="link" size="small" onClick={() => toggleVisible(false)}>Снять</Button>
          </>
        )}
      </Space>
    </>
  );
}

function DateRangeFilter({ value, onApply, close }: {
  value?: ColumnFilterValue;
  onApply: (v: ColumnFilterValue | undefined) => void;
  close: () => void;
}) {
  const outer: [string?, string?] = value?.kind === 'dateRange' ? [value.from, value.to] : [];
  const [draft, setDraft] = useState<[string?, string?]>(outer);
  useEffect(() => setDraft(outer), [outer[0], outer[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = () => {
    const [from, to] = draft;
    onApply(from || to ? { kind: 'dateRange', from, to } : undefined);
    close();
  };
  return (
    <>
      <DatePicker.RangePicker
        allowEmpty={[true, true]}
        format="DD.MM.YYYY"
        value={[draft[0] ? dayjs(draft[0]) : null, draft[1] ? dayjs(draft[1]) : null]}
        onChange={(d) => setDraft([d?.[0]?.format('YYYY-MM-DD'), d?.[1]?.format('YYYY-MM-DD')])}
        style={{ marginBottom: 8 }}
      />
      <br />
      <Space>
        <Button type="primary" size="small" onClick={apply}>ОК</Button>
        <Button size="small" onClick={() => { setDraft([]); onApply(undefined); close(); }}>Сброс</Button>
      </Space>
    </>
  );
}

function NumRangeFilter({ value, onApply, close }: {
  value?: ColumnFilterValue;
  onApply: (v: ColumnFilterValue | undefined) => void;
  close: () => void;
}) {
  const outer: [number?, number?] = value?.kind === 'numRange' ? [value.min, value.max] : [];
  const [draft, setDraft] = useState<[number?, number?]>(outer);
  useEffect(() => setDraft(outer), [outer[0], outer[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = () => {
    const [min, max] = draft;
    onApply(min != null || max != null ? { kind: 'numRange', min, max } : undefined);
    close();
  };
  return (
    <>
      <Space style={{ marginBottom: 8 }}>
        <InputNumber
          placeholder="от" value={draft[0]} style={{ width: 110 }}
          onChange={(v) => setDraft((d) => [v ?? undefined, d[1]])}
        />
        <InputNumber
          placeholder="до" value={draft[1]} style={{ width: 110 }}
          onChange={(v) => setDraft((d) => [d[0], v ?? undefined])}
        />
      </Space>
      <br />
      <Space>
        <Button type="primary" size="small" onClick={apply}>ОК</Button>
        <Button size="small" onClick={() => { setDraft([]); onApply(undefined); close(); }}>Сброс</Button>
      </Space>
    </>
  );
}

function HeaderFilterDropdown<T>({ spec, value, onChange, rows, group, close }: HeaderFilterArgs<T> & { close: () => void }) {
  return (
    <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
      {group && (
        <>
          <Checkbox checked={group.active} onChange={(e) => group.onToggle(e.target.checked)}>
            Группировать
          </Checkbox>
          <Divider style={{ margin: '8px 0' }} />
        </>
      )}
      {spec.kind === 'text' && <TextFilter value={value} onApply={onChange} close={close} />}
      {spec.kind === 'multi' && (
        <MultiFilter value={value} options={collectMultiOptions(rows, spec)} onApply={onChange} close={close} />
      )}
      {spec.kind === 'dateRange' && <DateRangeFilter value={value} onApply={onChange} close={close} />}
      {spec.kind === 'numRange' && <NumRangeFilter value={value} onApply={onChange} close={close} />}
    </div>
  );
}

/** Свойства колонки AntD: иконка воронки (подсвечена при активном отборе/группировке) + дропдаун. */
export function headerFilterCol<T>(args: HeaderFilterArgs<T>): Pick<ColumnType<T>, 'filterDropdown' | 'filterIcon'> {
  const active = isColumnFilterActive(args.value) || !!args.group?.active;
  return {
    filterIcon: () => <FilterOutlined style={{ color: active ? 'var(--est-primary)' : undefined }} />,
    filterDropdown: (p: FilterDropdownProps) => (
      <HeaderFilterDropdown {...args} close={() => p.confirm({ closeDropdown: true })} />
    ),
  };
}
