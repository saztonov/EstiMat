import { Button, InputNumber, Space, Tag, Tooltip } from 'antd';
import { NumberInput } from '../../../components/NumberInput';
import { EditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { LocationBadgesRow } from '../../estimates/components/LocationBadges';
import { formatMoney } from '../../estimates/components/types';
import type { OrderMaterialRow } from './orderRow';
import type { DimensionFinding } from './dimensionChecks';
import type { OnCostTypeCiphers } from './CostTypeCiphersModal';
import { remainingOf } from './remaining';

const EPS = 1e-6;
const qty = (v: number) => Math.round(v * 1e4) / 1e4;

interface Options {
  /** Уровень «Вид работ» выключен → материалы разных видов работ стоят рядом: показываем чей. */
  showCostType: boolean;
  /** Активен локационный отбор: «По смете» урезано, «Уже заявлено» — по всей смете. */
  locFilterActive: boolean;
  editing: boolean;
  /**
   * Объёмы сведены к конкретным подрядчикам (подрядчик смотрит своё либо включён отбор по
   * подрядчикам). Тогда «Кол-во по смете» и «Уже заявлено» сопоставимы, и черновик можно
   * складывать с заявленным. Это про скоуп данных, а не про роль смотрящего.
   */
  scoped: boolean;
  /** По смете есть хоть одна закупленная цена — иначе «Цена»/«Сумма» пусты и не нужны. */
  hasPrices: boolean;
  orderedMap: Map<string, number>;
  /**
   * Замечания по размерности, посчитанные по СМЕТНЫМ объёмам (до сведения к доле подрядчика):
   * дробь, возникшая из деления строки между подрядчиками, — не ошибка, и предупреждать о ней
   * нельзя. Ключ — orderKey, он от количества не зависит.
   */
  dimension: Map<string, DimensionFinding>;
  draft: Map<string, number>;
  /** Строки, где количество введено вручную: массовые действия их не трогают — это надо видеть. */
  manual?: Set<string>;
  onDraftChange: (orderKey: string, v: number | null) => void;
  onBreakdown: (m: OrderMaterialRow) => void;
  /** Клик по виду работ — показать назначенные ему шифры РД. */
  onCostTypeCiphers: OnCostTypeCiphers;
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
  scoped,
  hasPrices,
  orderedMap,
  dimension,
  draft,
  manual,
  onDraftChange,
  onBreakdown,
  onCostTypeCiphers,
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
        const over = scoped ? ordered + req > m.quantity + EPS : ordered > m.quantity + EPS;
        // Дробное количество штучного материала — та же проверка, что в умной группировке. Здесь она
        // закрывает и стандартное дерево, и секции «Общие расходные»/«Не удалось сгруппировать».
        const discrete = dimension.get(m.orderKey);
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
            {/* margin: 0 у тегов — зазор уже даёт Space, а собственный отступ antd раздувал бы
                ячейку на 8px с каждого тега. */}
            {m.hasSuggested && <Tag color="orange" style={{ margin: 0 }}>предложение</Tag>}
            {m.hasAi && <Tag color="blue" style={{ margin: 0 }}>ИИ</Tag>}
            {discrete && (
              <Tooltip
                title={`По смете ${discrete.quantity} ${m.unit} — штучный материал заказывают целым числом. Проверьте объём в смете.`}
              >
                <Tag color="orange" style={{ margin: 0 }}>Дробное количество</Tag>
              </Tooltip>
            )}
            {/* При активном отборе «По смете» урезано, а «Уже заявлено» — по всей смете:
                сравнивать их нельзя, иначе тег сработает ложно. */}
            {over && !locFilterActive && <Tag color="red" style={{ margin: 0 }}>Сверх сметы</Tag>}
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
      // Кликабельно, но не синее — как имя материала: колонка из ссылок читается как стена.
      render: (_, m) => (
        <Tooltip title="Показать шифры рабочей документации">
          <Button
            type="text"
            className="estimat-material-name"
            style={{ padding: 0, height: 'auto', color: 'var(--est-text-tertiary)', textAlign: 'left', whiteSpace: 'normal' }}
            onClick={() => onCostTypeCiphers({ costTypeId: m.costTypeId, costTypeName: m.costTypeName })}
          >
            {m.costTypeName ?? 'Без вида работ'}
          </Button>
        </Tooltip>
      ),
    });
  }

  cols.push(
    {
      title: 'Местоположение',
      key: 'location',
      // 356 ≈ 237×1.5. Бейджи зон, этажей и типов переносились по одному в строку и растили строку
      // в высоту, тогда как «Материал» — единственная колонка без ширины — забирал весь остаток и
      // пустовал. Ширину добираем именно у него.
      width: 356,
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
          m.orderUnitPrice == null ? <span style={{ color: 'var(--est-text-quaternary)' }}>—</span> : formatMoney(m.orderUnitPrice),
      },
      {
        title: <Tooltip title="Кол-во по смете × цена из заказа поставщику">Сумма</Tooltip>,
        key: 'total',
        width: 140,
        align: 'right',
        render: (_, m) =>
          m.materialCost == null ? <span style={{ color: 'var(--est-text-quaternary)' }}>—</span> : formatMoney(m.materialCost),
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
              scoped
                ? 'Заявлено по всей смете — без учёта отбора по местоположению'
                : 'Заявлено по всей смете всеми подрядчиками — без учёта отбора по местоположению'
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
          return v > 0 ? qty(v) : <span style={{ color: 'var(--est-text-quaternary)' }}>—</span>;
        },
      },
      {
        title: <Tooltip title="Кол-во по смете − уже заявлено">Остаток</Tooltip>,
        key: 'remaining',
        width: 110,
        align: 'right',
        render: (_, m) => {
          const left = remainingOf(m.quantity, orderedMap.get(m.orderKey) ?? 0);
          return left > 0 ? qty(left) : <span style={{ color: 'var(--est-text-quaternary)' }}>0</span>;
        },
      },
    );
  }

  // Колонка «Заявка» — только в режиме набора. В него не войти, если заявку создавать нельзя.
  if (editing) {
    cols.push({
      title: 'Заявка',
      key: 'request',
      width: 140,
      align: 'right',
      // Дробность вводимого количества здесь НЕ проверяем: при доле подрядчика остаток сам по себе
      // дробный (1 шт на двоих → 0.5), и предупреждение висело бы на законном вводе, а округление
      // вверх у обоих подрядчиков дало бы двойной заказ. Дробность — свойство сметы, и о ней
      // говорит тег в колонке «Материал».
      render: (_, m) => {
        const isManual = manual?.has(m.orderKey) ?? false;
        return (
          <Space size={4}>
            {/* Ручные строки массовый набор не перезаписывает — метка объясняет, почему строка
                не изменилась после нажатия «В заявку». */}
            {isManual && (
              <Tooltip title="Введено вручную: массовый набор эту строку не меняет">
                <EditOutlined style={{ color: 'var(--est-primary)', fontSize: 12 }} />
              </Tooltip>
            )}
            {/* size="small": поле дефолтного размера (32px) единолично задавало высоту строки
                в режиме набора и сводило на нет компактность таблицы. */}
            <NumberInput
              preset="quantity"
              min={0}
              size="small"
              style={{ width: 100 }}
              // Подсказка — остаток: сразу видно, сколько ещё можно заявить.
              placeholder={String(qty(remainingOf(m.quantity, orderedMap.get(m.orderKey) ?? 0)))}
              value={draft.get(m.orderKey)}
              onChange={(v) => onDraftChange(m.orderKey, v as number | null)}
            />
          </Space>
        );
      },
    });
  }

  return cols;
}
