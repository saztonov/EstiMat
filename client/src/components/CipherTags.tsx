import { Space, Tag, Tooltip } from 'antd';

/** Сколько шифров показать тегами, прежде чем свернуть остаток в «+N». */
const MAX_TAGS = 3;

interface Props {
  /** Коды шифров РД. Пустой набор — компонент не рендерится вовсе. */
  codes: string[];
  /** Показать все теги без свёртки (в модалке места хватает). */
  all?: boolean;
}

/**
 * Шифры рабочей документации тегами. У вида работ их до 50, а место есть только в шапке блока или
 * ячейке таблицы: показываем первые три, остальные — счётчиком с полным списком в подсказке.
 */
export function CipherTags({ codes, all = false }: Props) {
  if (codes.length === 0) return null;
  const shown = all ? codes : codes.slice(0, MAX_TAGS);
  const rest = codes.length - shown.length;

  return (
    <Space size={2} wrap>
      {shown.map((code) => (
        <Tag key={code} color="geekblue" style={{ margin: 0 }}>
          {code}
        </Tag>
      ))}
      {rest > 0 && (
        <Tooltip title={codes.join(', ')}>
          <Tag style={{ margin: 0 }}>+{rest}</Tag>
        </Tooltip>
      )}
    </Space>
  );
}
