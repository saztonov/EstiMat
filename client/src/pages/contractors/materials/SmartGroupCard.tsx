import { useMemo, useState, type KeyboardEvent } from 'react';
import { Alert, Collapse, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MaterialGroupDto } from '@estimat/shared';
import type { OrderMaterialRow } from './orderRow';
import type { BulkFill } from './MaterialTreeView';
import { GroupCard } from './GroupCard';
import { GroupFillButton } from './GroupFillButton';
import { locationBadgeKey, withLocationBlocks } from './locationSpans';
import type { DimensionFinding } from './dimensionChecks';
import type { OnCostTypeCiphers } from './CostTypeCiphersModal';
import type { SplitNode } from './smartSplit';
import { SmartSplitView } from './SmartSplitView';
import { groupCheck } from './smartReview';

/** Сколько корпусов показать тегами в шапке блока, прежде чем свернуть в «+N». */
const MAX_ZONE_TAGS = 4;
/** Длинные виды работ («Автомат-я, диспетч-я и мониторинг: …») иначе съедают всю шапку. */
const MAX_COST_TYPE_WIDTH = 220;
/** Замечаний по размерности может не быть вовсе — общая пустая карта вместо новой на каждый блок. */
const EMPTY_DIMENSION = new Map<string, DimensionFinding>();

interface Props {
  group: MaterialGroupDto;
  rows: OrderMaterialRow[];
  columns: ColumnsType<OrderMaterialRow>;
  collapsed: boolean;
  onToggle: (key: string) => void;
  bulk?: BulkFill;
  rowClassName?: (row: OrderMaterialRow) => string;
  /** Детерминированные замечания по строкам свода (ключ заказа → находка). */
  dimension?: Map<string, DimensionFinding>;
  /** Готовое дерево разбивки блока (строится в родителе). Пусто → плоская таблица строк. */
  splitTree: SplitNode[];
  /** Свёрнутые узлы разбивки (общее с картами пространство ключей smart:...). */
  collapsedNodes: Set<string>;
  /** Клик по тегу вида работ — показать его шифры РД (блок при этом не сворачивается). */
  onCostTypeCiphers: OnCostTypeCiphers;
}

const SEVERITY_LABEL: Record<string, string> = {
  warning: 'Предупреждение',
  review: 'Требует проверки',
  recommendation: 'Рекомендация',
};

/** Тип плашки резюме — по цвету бейджа, чтобы шапка и панель говорили об одной важности. */
const ALERT_TYPE = { red: 'error', orange: 'warning', gold: 'info' } as const;

/** Enter/Space на теге внутри кликабельной шапки: без остановки всплытия блок бы свернулся. */
const onActivate = (e: KeyboardEvent<HTMLElement>, run: () => void) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  e.stopPropagation();
  run();
};

export function SmartGroupCard({
  group,
  rows,
  columns,
  collapsed,
  onToggle,
  bulk,
  rowClassName,
  dimension,
  splitTree,
  collapsedNodes,
  onCostTypeCiphers,
}: Props) {
  // Панель проверки открывается и снаружи — кликом по бейджу в шапке.
  const [checkOpen, setCheckOpen] = useState(false);
  // Состояние проверки считает smartReview — тот же расчёт, что стоит за отбором «Только с
  // замечаниями». Размерность берём по видимым строкам: у подрядчика группа обрезана до его доли.
  const check = groupCheck(group, dimension ?? EMPTY_DIMENSION, rows.map((r) => r.orderKey));
  const dimIssues = check?.dimension ?? [];
  const openCheck = () => {
    setCheckOpen(true);
    // Свёрнутый блок панели не рисует вовсе — бейдж должен и раскрыть его.
    if (collapsed) onToggle(group.id);
  };
  // Вид работ группы: различает карточки-однофамильцы (одна операция в разных видах работ при
  // включённом виде работ не сливается — иначе на экране две одинаковые «Монтаж трубопровода»).
  const costTypes = [...new Set(rows.map((r) => r.costTypeName).filter((n): n is string => !!n))];
  const costTypeLabel = costTypes.length === 1 ? costTypes[0] : null;
  // id того же вида работ — для показа его шифров РД. Тег рисуется только при единственном
  // имени, поэтому достаточно первой строки с ним.
  const costTypeId = costTypeLabel
    ? rows.find((r) => r.costTypeName === costTypeLabel)?.costTypeId ?? null
    : null;
  // Корпуса блока — тегами в шапке: даёт увидеть географию блока, не раскрывая разбивку.
  const zoneNames = [...new Set(rows.flatMap((r) => r.zoneNames))].sort((a, b) => a.localeCompare(b, 'ru'));

  const draftCount = bulk ? rows.filter((r) => bulk.draftValues.has(r.orderKey)).length : 0;
  // Блоки местоположения — по строкам этой таблицы: rowSpan и полосы привязаны к порядку
  // dataSource и через границы карточек не переносятся.
  const loc = useMemo(
    () => withLocationBlocks(columns, rows, locationBadgeKey, rowClassName),
    [columns, rows, rowClassName],
  );

  return (
    <GroupCard
      collapsed={collapsed}
      onToggle={() => onToggle(group.id)}
      title={
        <>
          {/* Назначение операции — подсказкой: в строке оно спорило с названием за внимание. */}
          <Tooltip title={group.purpose || undefined}>
            <strong style={{ fontSize: 14 }}>{group.name}</strong>
          </Tooltip>
          {/* Одно сообщение вместо пары «статус + счётчик»: они говорили об одном и том же.
              Цвет несёт важность, подсказка — причину, клик ведёт к самому результату. */}
          {check && (
            <Tooltip title={`${check.axes[0] ?? 'Есть замечания'} — открыть результат проверки`}>
              <Tag
                color={check.color}
                role="button"
                tabIndex={0}
                style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  openCheck();
                }}
                onKeyDown={(e) => onActivate(e, openCheck)}
              >
                Проверить · {check.count}
              </Tag>
            </Tooltip>
          )}
        </>
      }
      meta={<span style={{ color: 'var(--est-text-tertiary)', fontSize: 12 }}>{rows.length} поз.</span>}
      right={
        <>
          {/* Тег вида работ открывает его шифры РД. Он лежит внутри кликабельной шапки, поэтому
              без stopPropagation клик заодно свернул бы весь блок. */}
          {costTypeLabel && (
            <Tooltip title={`${costTypeLabel} — показать шифры рабочей документации`}>
              <Tag
                color="blue"
                role="button"
                tabIndex={0}
                style={{
                  cursor: 'pointer',
                  marginInlineEnd: 0,
                  display: 'inline-block',
                  maxWidth: MAX_COST_TYPE_WIDTH,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  verticalAlign: 'middle',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onCostTypeCiphers({ costTypeId, costTypeName: costTypeLabel });
                }}
                onKeyDown={(e) =>
                  onActivate(e, () => onCostTypeCiphers({ costTypeId, costTypeName: costTypeLabel }))
                }
              >
                {costTypeLabel}
              </Tag>
            </Tooltip>
          )}
          {zoneNames.slice(0, MAX_ZONE_TAGS).map((z) => (
            <Tag key={z} color="geekblue" style={{ marginInlineEnd: 0 }}>
              {z}
            </Tag>
          ))}
          {zoneNames.length > MAX_ZONE_TAGS && (
            <Tooltip title={zoneNames.slice(MAX_ZONE_TAGS).join(', ')}>
              <Tag style={{ marginInlineEnd: 0 }}>+{zoneNames.length - MAX_ZONE_TAGS}</Tag>
            </Tooltip>
          )}
        </>
      }
      extra={
        bulk && (
          <GroupFillButton rows={rows} draftCount={draftCount} onFill={bulk.onFill} onClear={bulk.onClear} />
        )
      }
    >
      {check && (
        <Collapse
          size="small"
          style={{ margin: 8 }}
          activeKey={checkOpen ? ['check'] : []}
          onChange={(k) => setCheckOpen((Array.isArray(k) ? k.length : Number(!!k)) > 0)}
          items={[
            {
              key: 'check',
              label: `Результат проверки (${check.count})`,
              children: (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {/* Почему блок помечен — первой строкой и всегда: оси комплектности и
                      совместимости независимы от замечаний, и без резюме причина бейджа терялась. */}
                  {check.axes.length > 0 && (
                    <Alert
                      type={ALERT_TYPE[check.color]}
                      showIcon
                      message="Почему блок помечен"
                      description={
                        <>
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {check.axes.map((a) => (
                              <li key={a}>{a}</li>
                            ))}
                          </ul>
                          {check.details === 0 && (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              Конкретных замечаний ИИ не назвал — проверьте состав блока вручную
                            </Typography.Text>
                          )}
                        </>
                      }
                    />
                  )}
                  {/* Детерминированная проверка — первой: это факт из сметы, а не мнение модели. */}
                  {dimIssues.length > 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      message="Дробное количество в штучной единице"
                      description={
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {dimIssues.map((f) => (
                            <li key={f.orderKey}>
                              {f.name} — по смете {f.quantity} {f.unit}; штучный материал заказывают
                              целым числом, ближайшее целое — {f.suggested}
                            </li>
                          ))}
                        </ul>
                      }
                    />
                  )}
                  {group.issues.map((i, idx) => (
                    <Alert
                      key={`i${idx}`}
                      type={i.severity === 'warning' ? 'warning' : 'info'}
                      showIcon
                      message={`${SEVERITY_LABEL[i.severity] ?? ''}: ${i.message}`}
                      description={
                        i.orderKeys.length ? (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            Относится к: {namesOf(i.orderKeys, rows)}
                          </Typography.Text>
                        ) : undefined
                      }
                    />
                  ))}
                  {group.missing.length > 0 && (
                    <Alert
                      type="info"
                      showIcon
                      message="Возможно, не хватает"
                      description={
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {group.missing.map((m, idx) => (
                            <li key={`m${idx}`}>
                              <strong>{m.name}</strong>
                              {m.reason ? ` — ${m.reason}` : ''}
                            </li>
                          ))}
                        </ul>
                      }
                    />
                  )}
                </Space>
              ),
            },
          ]}
        />
      )}

      {splitTree.length > 0 ? (
        <div style={{ padding: 8 }}>
          <SmartSplitView
            nodes={splitTree}
            collapsed={collapsedNodes}
            onToggle={onToggle}
            onCostTypeCiphers={onCostTypeCiphers}
          />
        </div>
      ) : (
        <Table<OrderMaterialRow>
          rowKey="orderKey"
          size="small"
          className="estimat-compact"
          pagination={false}
          dataSource={rows}
          columns={loc.columns}
          rowClassName={loc.rowClassName}
          scroll={{ x: 1100 }}
        />
      )}
    </GroupCard>
  );
}

const namesOf = (keys: string[], rows: OrderMaterialRow[]) =>
  keys
    .map((k) => rows.find((r) => r.orderKey === k)?.name)
    .filter(Boolean)
    .join(' · ');
