// Массовое добавление группы в заявку: одно действие в шапке блока.
//
// Доля фиксирована сотней: набирают весь незаявленный остаток, а частный объём вводят построчно.
// Кнопка — главное действие шапки, поэтому она цветная и стоит у правого края.
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
  /** Сколько строк области уже в заявке. */
  draftCount: number;
  onFill: (rows: OrderMaterialRow[]) => void;
  onClear: (rows: OrderMaterialRow[]) => void;
}

export function GroupFillButton({ rows, draftCount, onFill, onClear }: Props) {
  if (rows.length === 0) return null;
  return (
    <Space size={4}>
      {draftCount > 0 && (
        <span style={{ color: 'var(--est-primary)', fontSize: 12 }}>
          выбрано {draftCount} из {rows.length}
        </span>
      )}
      {/* Заголовок — функцией: иначе подсчёт для сотни узлов выполнялся бы на каждый рендер. */}
      <Tooltip title={() => `Добавить в заявку весь остаток по ${rows.length} поз.`}>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => onFill(rows)}>
          100%
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
