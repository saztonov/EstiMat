import { useRef } from 'react';
import { Button, Input, Space } from 'antd';
import type { InputRef } from 'antd';
import type { ColumnType } from 'antd/es/table';
import { SearchOutlined } from '@ant-design/icons';

/**
 * Колоночный поиск по свободному вводу (иконка-лупа в заголовке столбца).
 * Возвращает готовый набор свойств колонки Ant Design Table.
 *
 * Использование:
 *   const { getColumnSearchProps } = useColumnSearch<Row>();
 *   { title: 'ФИО', dataIndex: 'full_name', ...getColumnSearchProps((r) => r.full_name) }
 *
 * `getText` вместо `dataIndex` — чтобы искать и по вычисляемым колонкам,
 * и сразу по нескольким полям (например «код + наименование»).
 */
export function useColumnSearch<T>() {
  const inputRef = useRef<InputRef>(null);

  const getColumnSearchProps = (getText: (record: T) => string | null | undefined): ColumnType<T> => ({
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
      <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
        <Input
          ref={inputRef}
          placeholder="Поиск"
          allowClear
          value={selectedKeys[0] as string}
          onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
          onPressEnter={() => confirm()}
          style={{ marginBottom: 8, display: 'block', width: 200 }}
        />
        <Space>
          <Button type="primary" size="small" icon={<SearchOutlined />} onClick={() => confirm()}>
            Найти
          </Button>
          <Button
            size="small"
            onClick={() => {
              clearFilters?.();
              confirm();
            }}
          >
            Сбросить
          </Button>
        </Space>
      </div>
    ),
    filterIcon: (filtered: boolean) => (
      <SearchOutlined style={{ color: filtered ? '#1677ff' : undefined }} />
    ),
    onFilter: (value, record) =>
      String(getText(record) ?? '')
        .toLowerCase()
        .includes(String(value).toLowerCase()),
    onFilterDropdownOpenChange: (open) => {
      if (open) setTimeout(() => inputRef.current?.select(), 80);
    },
  });

  return { getColumnSearchProps };
}

/**
 * Отбор по типам: строит `{ text, value }[]` из уникальных непустых значений поля.
 * Для колонок, где набор значений приходит с сервера (тип/состояние и т.п.).
 */
export function uniqueFilters<T>(
  rows: T[],
  getVal: (record: T) => string | null | undefined,
): { text: string; value: string }[] {
  const values = Array.from(
    new Set(rows.map((r) => getVal(r)).filter((v): v is string => !!v)),
  );
  values.sort((a, b) => a.localeCompare(b));
  return values.map((v) => ({ text: v, value: v }));
}
