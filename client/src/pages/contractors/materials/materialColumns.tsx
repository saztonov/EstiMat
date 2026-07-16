import { Button, InputNumber, Space, Tag, Tooltip } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { checkDiscreteQuantity } from '@estimat/shared';
import { LocationBadgesRow } from '../../estimates/components/LocationBadges';
import { formatMoney } from '../../estimates/components/types';
import type { OrderMaterialRow } from './orderRow';
import { remainingOf } from './remaining';

const EPS = 1e-6;
const qty = (v: number) => Math.round(v * 1e4) / 1e4;

interface Options {
  /** Уровень «Вид работ» выключен → материалы разных видов работ стоят рядом: показываем чей. */
  showCostType: boolean;
  /** Активен локационный отбор: «По смете» урезано, «Уже заявлено» — по всей смете. */
  locFilterActive: boolean;
  editing: boolean;
  viewerIsContractor: boolean;
  /** По смете есть хоть одна закупленная цена — иначе «Цена»/«Сумма» пусты и не нужны. */
  hasPrices: boolean;
  orderedMap: Map<string, number>;
  draft: Map<string, number>;
  /** Строки, где количество введено вручную: массовые действия их не трогают — это надо видеть. */
  manual?: Set<string>;
  onDraftChange: (orderKey: string, v: number | null) => void;
  onBreakdown: (m: OrderMaterialRow) => void;
}

/**
 * Колонки таблицы материалов — общие для стандартного и умного режима.
 *
 * Ключ заказа берётся из самой строки (row.orderKey): строка атомарна, поэтому «Уже заявлено»
 * и «Сверх сметы» считаются одинаково при любых уровнях группировки.
 */
export function buildMaterialColumns({
  showCostType,
  locFilterActive,
  editing,
  viewerIsContractor,
  hasPrices,
  orderedMap,
  draft,
  manual,
  onDraftChange,
  onBreakdown,
}: Options): ColumnsType<OrderMaterialRow> {
  // Цена и сумма приходят из оформленной закупки. Пока по смете не закупали ничего, обе колонки —
  // сплошные прочерки: не занимаем ими ширину. В режиме заявки деньги тоже ни к чему — там считают
  // количества.
  const showPrices = !editing && hasPrices;
  // Заявок по смете нет — «Уже заявлено» пусто, а «Остаток» дублирует «Кол-во по смете».
  const showOrdered = orderedMap.size > 0;

  const cols: ColumnsType<OrderMaterialRow> = [
    {
      title: 'Материал',
      dataIndex: 'name',
      key: 'name',
      render: (_, m) => {
        const ordered = orderedMap.get(m.orderKey) ?? 0;
        const req = draft.get(m.orderKey) ?? 0;
        const over = viewerIsContractor ? ordered + req > m.quantity + EPS : ordered > m.quantity + EPS;
        // Дробное количество штучного материала — та же проверка, что в умной группировке. Здесь она
        // закрывает и стандартное дерево, и секции «Общие расходные»/«Не удалось сгруппировать».
        const discrete = checkDiscreteQuantity(m.unit, m.quantity);
        return (
          <Space size={4}>
            {/* Имя кликабельно (детализация по местоположениям), но не синее: на экране десятки
                строк, и колонка из ссылок читается как стена, конкурируя с реальными действиями. */}
            <Button
              type="text"
              className="estimat-material-name"
              style={{ padding: 0, height: 'auto' }}
              onClick={() => onBreakdown(m)}
            >
              {m.name}
            </Button>
            {m.hasSuggested && <Tag color="orange">предложение</Tag>}
            {m.hasAi && <Tag color="blue">ИИ</Tag>}
            {discrete && (
              <Tooltip
                title={`Заказ возможен только целым числом, ближайшее целое — ${discrete.suggested} ${m.unit}`}
              >
                <Tag color="orange">Дробное количество</Tag>
              </Tooltip>
            )}
            {/* При активном отборе «По смете» урезано, а «Уже заявлено» — по всей смете:
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
  );

  // Цена и сумма — из оформленной закупки, а не из сметы. Пока материал не закупали, цены нет:
  // показываем прочерк, а не 0 ₽ — иначе бесплатный материал не отличить от неизвестной цены.
  if (showPrices) {
    cols.push(
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
    );
  }

  // «Уже заявлено», а не «Заказано»: это сумма строк заявок подрядчика, а не размещённое в заказах
  // поставщику. Рядом — остаток: сколько ещё можно заявить (он же база для набора долей).
  if (showOrdered) {
    cols.push(
      {
        title: (
          <Tooltip
            title={
              viewerIsContractor
                ? 'Заявлено по всей смете — без учёта отбора по местоположению'
                : 'Заявлено по всей смете (с учётом отбора по подрядчикам) — без учёта отбора по местоположению'
            }
          >
            Уже заявлено
          </Tooltip>
        ),
        key: 'ordered',
        width: 120,
        align: 'right',
        render: (_, m) => {
          const v = orderedMap.get(m.orderKey) ?? 0;
          return v > 0 ? qty(v) : <span style={{ color: '#bfbfbf' }}>—</span>;
        },
      },
      {
        title: <Tooltip title="Кол-во по смете − уже заявлено">Остаток</Tooltip>,
        key: 'remaining',
        width: 110,
        align: 'right',
        render: (_, m) => {
          const left = remainingOf(m.quantity, orderedMap.get(m.orderKey) ?? 0);
          return left > 0 ? qty(left) : <span style={{ color: '#bfbfbf' }}>0</span>;
        },
      },
    );
  }

  // Колонка «Заявка» — только в режиме заявки (подрядчик).
  if (editing && viewerIsContractor) {
    cols.push({
      title: 'Заявка',
      key: 'request',
      width: 140,
      align: 'right',
      render: (_, m) => {
        const isManual = manual?.has(m.orderKey) ?? false;
        // Дробное количество проверяем и у заявляемого объёма, а не только у сметного.
        const badQty = checkDiscreteQuantity(m.unit, draft.get(m.orderKey) ?? 0);
        return (
          <Space size={4}>
            {/* Ручные строки массовый набор не перезаписывает — метка объясняет, почему строка
                не изменилась после нажатия «В заявку». */}
            {isManual && (
              <Tooltip title="Введено вручную: массовый набор эту строку не меняет">
                <EditOutlined style={{ color: '#1677ff', fontSize: 12 }} />
              </Tooltip>
            )}
            <Tooltip
              title={
                badQty
                  ? `Штучный материал: заказ возможен только целым числом (ближайшее — ${badQty.suggested})`
                  : undefined
              }
            >
              <InputNumber
                min={0}
                style={{ width: 100 }}
                status={badQty ? 'warning' : undefined}
                // Подсказка — остаток: сразу видно, сколько ещё можно заявить.
                placeholder={String(qty(remainingOf(m.quantity, orderedMap.get(m.orderKey) ?? 0)))}
                value={draft.get(m.orderKey)}
                onChange={(v) => onDraftChange(m.orderKey, v as number | null)}
              />
            </Tooltip>
          </Space>
        );
      },
    });
  }

  return cols;
}
