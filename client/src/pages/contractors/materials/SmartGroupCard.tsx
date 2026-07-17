import { Alert, Collapse, Space, Table, Tag, Typography } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { MaterialGroupDto } from '@estimat/shared';
import { formatMoney } from '../../estimates/components/types';
import type { OrderMaterialRow } from './orderRow';
import type { BulkFill } from './MaterialTreeView';
import { GroupFillButton } from './GroupFillButton';
import type { DimensionFinding } from './dimensionChecks';

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
}

/**
 * Подпись статуса — проекция двух независимых осей (комплектность × совместимость) на понятные
 * сметчику формулировки из ТЗ. Одним enum это не выразить: группа может быть полной, но с
 * возможной несостыковкой, и наоборот.
 *
 * У благополучной группы тега НЕТ: на смете из тридцати операций двадцать пять зелёных «Комплект
 * выглядит полным» — шум, в котором теряется единственный красный. Отсутствие тега и есть «всё в
 * порядке».
 */
export function groupStatus(g: MaterialGroupDto): { label: string; color: string } | null {
  if (g.compatibility === 'possible_issue') return { label: 'Возможные несовместимости', color: 'red' };
  if (g.completeness === 'incomplete') return { label: 'Неполный комплект', color: 'orange' };
  if (g.completeness === 'complete' && g.compatibility === 'no_issues') return null;
  // Модель не смогла сделать вывод — это честный ответ, а не ошибка.
  return { label: 'Требует проверки', color: 'gold' };
}

const SEVERITY_LABEL: Record<string, string> = {
  warning: 'Предупреждение',
  review: 'Требует проверки',
  recommendation: 'Рекомендация',
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
}: Props) {
  // Итог — только по строкам с ценой закупки: сметные цены материалов во вкладке не показываются.
  const priced = rows.filter((r) => r.materialCost != null);
  const total = priced.reduce((s, r) => s + (r.materialCost ?? 0), 0);
  const status = groupStatus(group);
  // Детерминированные замечания входят в счётчик наравне с модельными: иначе блок проверки у
  // группы без замечаний ИИ просто не отрисуется, и находка останется невидимой.
  const dimIssues = dimension ? rows.map((r) => dimension.get(r.orderKey)).filter((f) => !!f) : [];
  const findings = group.issues.length + group.missing.length + dimIssues.length;
  // Вид работ группы: различает карточки-однофамильцы (одна операция в разных видах работ при
  // включённом виде работ не сливается — иначе на экране две одинаковые «Монтаж трубопровода»).
  const costTypes = [...new Set(rows.map((r) => r.costTypeName).filter((n): n is string => !!n))];
  const costTypeLabel = costTypes.length === 1 ? costTypes[0] : null;

  const draftCount = bulk ? rows.filter((r) => bulk.draftValues.has(r.orderKey)).length : 0;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Кликабельная часть шапки и кнопка набора — сиблинги: клик по шапке сворачивает карточку,
          клик по кнопке до неё не доходит без stopPropagation. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Space size={8} style={{ flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => onToggle(group.id)}>
          {collapsed ? <RightOutlined style={{ fontSize: 11 }} /> : <DownOutlined style={{ fontSize: 11 }} />}
          <strong style={{ fontSize: 14 }}>{group.name}</strong>
          {costTypeLabel && <Tag color="blue">{costTypeLabel}</Tag>}
          {status && <Tag color={status.color}>{status.label}</Tag>}
          {/* Счётчик находок — в шапке: иначе он виден только у развёрнутой карточки, внутри
              второго сворачивания. */}
          {findings > 0 && <Tag>Проверить · {findings}</Tag>}
          {group.purpose && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {group.purpose}
            </Typography.Text>
          )}
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>{rows.length} поз.</span>
          {priced.length > 0 && <span style={{ color: '#1677ff' }}>{formatMoney(total)}</span>}
        </Space>
        {bulk && (
          <GroupFillButton
            rows={rows}
            percent={bulk.percent}
            draftCount={draftCount}
            onFill={bulk.onFill}
            onClear={bulk.onClear}
          />
        )}
      </div>

      {!collapsed && findings > 0 && (
        <Collapse
          size="small"
          style={{ marginBottom: 8 }}
          items={[
            {
              key: 'check',
              label: `Результат проверки (${findings})`,
              children: (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
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

      {!collapsed && (
        <Table<OrderMaterialRow>
          rowKey="orderKey"
          size="small"
          pagination={false}
          dataSource={rows}
          columns={columns}
          rowClassName={rowClassName}
          scroll={{ x: 1100 }}
        />
      )}
    </div>
  );
}

const namesOf = (keys: string[], rows: OrderMaterialRow[]) =>
  keys
    .map((k) => rows.find((r) => r.orderKey === k)?.name)
    .filter(Boolean)
    .join(' · ');
