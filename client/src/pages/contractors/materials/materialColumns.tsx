import { Button, InputNumber, Space, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { LocationBadgesRow } from '../../estimates/components/LocationBadges';
import { formatMoney } from '../../estimates/components/types';
import type { OrderMaterialRow } from './orderRow';

const EPS = 1e-6;
const qty = (v: number) => Math.round(v * 1e4) / 1e4;

interface Options {
  /** Уровень «Вид работ» выключен → материалы разных видов работ стоят рядом: показываем чей. */
  showCostType: boolean;
  /** Активен локационный отбор: «По смете» урезано, «Заказано» — по всей смете. */
  locFilterActive: boolean;
  editing: boolean;
  viewerIsContractor: boolean;
  orderedMap: Map<string, number>;
  draft: Map<string, number>;
  onDraftChange: (orderKey: string, v: number | null) => void;
  onBreakdown: (m: OrderMaterialRow) => void;
}

/**
 * Колонки таблицы материалов — общие для стандартного и умного режима.
 *
 * Ключ заказа берётся из самой строки (row.orderKey): строка атомарна, поэтому «Заказано»
 * и «Сверх сметы» считаются одинаково при любых уровнях группировки.
 */
export function buildMaterialColumns({
  showCostType,
  locFilterActive,
  editing,
  viewerIsContractor,
  orderedMap,
  draft,
  onDraftChange,
  onBreakdown,
}: Options): ColumnsType<OrderMaterialRow> {
  const cols: ColumnsType<OrderMaterialRow> = [
    {
      title: 'Материал',
      dataIndex: 'name',
      key: 'name',
      render: (_, m) => {
        const ordered = orderedMap.get(m.orderKey) ?? 0;
        const req = draft.get(m.orderKey) ?? 0;
        const over = viewerIsContractor ? ordered + req > m.quantity + EPS : ordered > m.quantity + EPS;
        return (
          <Space size={4}>
            <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => onBreakdown(m)}>
              {m.name}
            </Button>
            {m.hasSuggested && <Tag color="orange">предложение</Tag>}
            {m.hasAi && <Tag color="blue">ИИ</Tag>}
            {/* При активном отборе «По смете» урезано, а «Заказано» — по всей смете:
                сравнивать их нельзя, иначе тег сработает ложно. */}
            {over && !locFilterActive && <Tag color="red">Сверх сметы</Tag>}
          </Space>
        );
      },
    },
  ];

  if (showCostType) {
    cols.push({
      title: 'Вид работ',
      key: 'costType',
      width: 180,
      render: (_, m) => (
        <span style={{ color: '#8c8c8c' }}>{m.costTypeName ?? 'Без вида работ'}</span>
      ),
    });
  }

  cols.push(
    {
      title: 'Местоположение',
      key: 'location',
      width: 237,
      render: (_, m) => (
        <LocationBadgesRow zoneNames={m.zoneNames} floorsLabel={m.floorsLabel} typeLabels={m.typeLabels} />
      ),
    },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
    {
      title: 'Кол-во по смете',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 130,
      align: 'right',
      render: (v: number) => qty(v),
    },
    // Цена и сумма — из оформленной закупки, а не из сметы. Пока материал не закупали, цены нет:
    // показываем прочерк, а не 0 ₽ — иначе бесплатный материал не отличить от неизвестной цены.
    {
      title: <Tooltip title="Цена из заказа поставщику (без НДС). Здесь не заполняется">Цена</Tooltip>,
      key: 'price',
      width: 120,
      align: 'right',
      render: (_, m) =>
        m.orderUnitPrice == null ? <span style={{ color: '#bfbfbf' }}>—</span> : formatMoney(m.orderUnitPrice),
    },
    {
      title: <Tooltip title="Кол-во по смете × цена из заказа поставщику">Сумма</Tooltip>,
      key: 'total',
      width: 140,
      align: 'right',
      render: (_, m) =>
        m.materialCost == null ? <span style={{ color: '#bfbfbf' }}>—</span> : formatMoney(m.materialCost),
    },
    {
      title: (
        <Tooltip
          title={
            viewerIsContractor
              ? 'Заказано по всей смете — без учёта отбора по местоположению'
              : 'Заказано по всей смете (с учётом отбора по подрядчикам) — без учёта отбора по местоположению'
          }
        >
          Заказано
        </Tooltip>
      ),
      key: 'ordered',
      width: 100,
      align: 'right',
      render: (_, m) => {
        const v = orderedMap.get(m.orderKey) ?? 0;
        return v > 0 ? qty(v) : <span style={{ color: '#bfbfbf' }}>—</span>;
      },
    },
  );

  // Колонка «Заявка» — только в режиме заявки (подрядчик).
  if (editing && viewerIsContractor) {
    cols.push({
      title: 'Заявка',
      key: 'request',
      width: 120,
      align: 'right',
      render: (_, m) => (
        <InputNumber
          min={0}
          style={{ width: 100 }}
          value={draft.get(m.orderKey)}
          onChange={(v) => onDraftChange(m.orderKey, v as number | null)}
        />
      ),
    });
  }

  cols.push({
    title: <Tooltip title="Поставки — следующая итерация">Поставлено</Tooltip>,
    key: 'delivered',
    width: 100,
    align: 'right',
    render: () => <span style={{ color: '#bfbfbf' }}>—</span>,
  });

  return cols;
}
