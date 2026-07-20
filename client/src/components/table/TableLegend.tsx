import type { CSSProperties } from 'react';
import { Space, Tooltip, Typography } from 'antd';
import type { RowHighlight } from '../../lib/rowHighlights';

const { Text } = Typography;

/**
 * Легенда подсветки строк таблицы. Свотч повторяет саму подсветку — заливку и полосу слева, —
 * поэтому связь «цвет в таблице ↔ подпись» видна без догадок.
 *
 * Рендерить имеет смысл, только когда подсвеченные строки в таблице действительно есть: пустая
 * легенда объясняет то, чего пользователь не видит.
 */
export function TableLegend({ items, style }: { items: RowHighlight[]; style?: CSSProperties }) {
  if (!items.length) return null;
  return (
    <Space size={12} wrap style={{ ...style }}>
      {items.map((h) => {
        const swatch = (
          <Space size={6}>
            <span
              style={{
                display: 'inline-block', width: 12, height: 12, borderRadius: 2,
                background: h.bg, boxShadow: `inset 2px 0 0 ${h.accent}`,
              }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>{h.label}</Text>
          </Space>
        );
        return h.hint
          ? <Tooltip key={h.className} title={h.hint}>{swatch}</Tooltip>
          : <span key={h.className}>{swatch}</span>;
      })}
    </Space>
  );
}
