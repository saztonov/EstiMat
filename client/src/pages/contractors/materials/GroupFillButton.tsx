// Массовое добавление группы в заявку: одно действие в заголовке узла/карточки.
//
// Подпись кнопки — это и есть текущая доля («В заявку · 50%»), поэтому все кнопки на экране разом
// показывают, что произойдёт по клику: режим виден, а не спрятан. Клик по самому заголовку
// по-прежнему сворачивает группу — кнопка рендерится сиблингом кликабельной области, поэтому
// stopPropagation не нужен.
//
// ВАЖНО: массовое действие допустимо только в режиме заявки, где локационный отбор снят и
// заблокирован. Тогда видимый набор строк совпадает с тем, что уходит в заявку. Если отбор в
// режиме заявки когда-нибудь разблокируют, заливка по видимому узлу станет неполной.
import { Button, Space, Tooltip } from 'antd';
import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import type { OrderMaterialRow } from './orderRow';

interface Props {
  /** Строки области действия: поддерево узла или строки ИИ-группы. */
  rows: OrderMaterialRow[];
  /** Текущая доля остатка, (0, 100]. */
  percent: number;
  /** Сколько строк области уже в заявке. */
  draftCount: number;
  onFill: (rows: OrderMaterialRow[], percent: number) => void;
  onClear: (rows: OrderMaterialRow[]) => void;
}

export function GroupFillButton({ rows, percent, draftCount, onFill, onClear }: Props) {
  if (rows.length === 0) return null;
  return (
    <Space size={4}>
      {draftCount > 0 && (
        <span style={{ color: '#1677ff', fontSize: 12 }}>
          выбрано {draftCount} из {rows.length}
        </span>
      )}
      {/* Заголовок — функцией: иначе подсчёт для сотни узлов выполнялся бы на каждый рендер. */}
      <Tooltip title={() => `Добавить в заявку ${percent}% остатка по ${rows.length} поз.`}>
        <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => onFill(rows, percent)}>
          {percent}%
        </Button>
      </Tooltip>
      {draftCount > 0 && (
        <Tooltip title="Убрать группу из заявки">
          <Button
            type="text"
            size="small"
            aria-label="Убрать группу из заявки"
            icon={<CloseOutlined />}
            onClick={() => onClear(rows)}
          />
        </Tooltip>
      )}
    </Space>
  );
}
