import { Alert, Collapse, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MaterialGroupDto } from '@estimat/shared';
import { formatMoney } from '../../estimates/components/types';
import type { OrderMaterialRow } from './orderRow';

interface Props {
  group: MaterialGroupDto;
  rows: OrderMaterialRow[];
  columns: ColumnsType<OrderMaterialRow>;
}

/**
 * Подпись статуса — проекция двух независимых осей (комплектность × совместимость) на понятные
 * сметчику формулировки из ТЗ. Одним enum это не выразить: группа может быть полной, но с
 * возможной несостыковкой, и наоборот.
 */
export function groupStatus(g: MaterialGroupDto): { label: string; color: string } {
  if (g.compatibility === 'possible_issue') return { label: 'Возможные несовместимости', color: 'red' };
  if (g.completeness === 'incomplete') return { label: 'Неполный комплект', color: 'orange' };
  if (g.completeness === 'complete' && g.compatibility === 'no_issues') {
    return { label: 'Комплект выглядит полным', color: 'green' };
  }
  // Модель не смогла сделать вывод — это честный ответ, а не ошибка.
  return { label: 'Требует проверки', color: 'gold' };
}

const SEVERITY_LABEL: Record<string, string> = {
  warning: 'Предупреждение',
  review: 'Требует проверки',
  recommendation: 'Рекомендация',
};

export function SmartGroupCard({ group, rows, columns }: Props) {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const status = groupStatus(group);
  const findings = group.issues.length + group.missing.length;
  // Вид работ группы: различает карточки-однофамильцы (одна операция в разных видах работ при
  // включённом виде работ не сливается — иначе на экране две одинаковые «Монтаж трубопровода»).
  const costTypes = [...new Set(rows.map((r) => r.costTypeName).filter((n): n is string => !!n))];
  const costTypeLabel = costTypes.length === 1 ? costTypes[0] : null;

  return (
    <div style={{ marginBottom: 16 }}>
      <Space size={8} style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14 }}>{group.name}</strong>
        {costTypeLabel && <Tag color="blue">{costTypeLabel}</Tag>}
        <Tag color={status.color}>{status.label}</Tag>
        {group.purpose && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {group.purpose}
          </Typography.Text>
        )}
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>{rows.length} поз.</span>
        <span style={{ color: '#1677ff' }}>{formatMoney(total)}</span>
      </Space>

      {findings > 0 && (
        <Collapse
          size="small"
          style={{ marginBottom: 8 }}
          items={[
            {
              key: 'check',
              label: `Результат проверки (${findings})`,
              children: (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
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

      <Table<OrderMaterialRow>
        rowKey="orderKey"
        size="small"
        pagination={false}
        dataSource={rows}
        columns={columns}
        scroll={{ x: 1100 }}
      />
    </div>
  );
}

const namesOf = (keys: string[], rows: OrderMaterialRow[]) =>
  keys
    .map((k) => rows.find((r) => r.orderKey === k)?.name)
    .filter(Boolean)
    .join(' · ');
