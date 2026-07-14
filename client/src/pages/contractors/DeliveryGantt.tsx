import { Typography, Tooltip, Empty, Tag } from 'antd';

const { Text } = Typography;

// Материал с графиком поставки для диаграммы. date — 'YYYY-MM-DD'.
export interface GanttMaterial {
  key: string;
  name: string;
  unit: string;
  totalQty: number;
  schedule: { date: string; qty: number }[];
}

const LABEL_W = 260;

function parseDate(d: string): number {
  const [y, m, dd] = d.split('-');
  return new Date(Number(y), Number(m) - 1, Number(dd)).getTime();
}
function fmtDate(d: string): string {
  const [y, m, dd] = d.split('-');
  return `${dd}.${m}.${y}`;
}
const num = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Лёгкая диаграмма Ганта графика поставки (CSS/flex, без внешних библиотек). Для каждого материала —
 * трек по общей шкале дат заявки; на позиции даты — метка с количеством. Одна дата — вырождается в
 * простую отметку по центру. Переиспользуется в окне создания и карточке заявки.
 */
export function DeliveryGantt({ materials }: { materials: GanttMaterial[] }) {
  const withSchedule = materials.filter((m) => m.schedule.length > 0);
  const allDates = Array.from(new Set(withSchedule.flatMap((m) => m.schedule.map((s) => s.date)))).sort();
  if (allDates.length === 0)
    return <Empty description="График поставки не задан" image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  const min = parseDate(allDates[0]!);
  const max = parseDate(allDates[allDates.length - 1]!);
  const span = max - min;
  const posOf = (d: string) => (span > 0 ? ((parseDate(d) - min) / span) * 100 : 50);
  // Крайние метки не должны вылезать за трек.
  const shiftOf = (p: number) => (p <= 1 ? '0' : p >= 99 ? '-100%' : '-50%');

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <div style={{ minWidth: 640 }}>
        {/* Ось дат */}
        <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 8 }}>
          <div style={{ width: LABEL_W, flexShrink: 0 }} />
          <div style={{ position: 'relative', flex: 1, height: 20, borderBottom: '1px solid #f0f0f0' }}>
            {allDates.map((d) => {
              const p = posOf(d);
              return (
                <div
                  key={d}
                  style={{
                    position: 'absolute', left: `${p}%`, transform: `translateX(${shiftOf(p)})`,
                    fontSize: 11, color: '#8c8c8c', whiteSpace: 'nowrap',
                  }}
                >
                  {fmtDate(d)}
                </div>
              );
            })}
          </div>
        </div>

        {/* Строки материалов */}
        {withSchedule.map((m) => (
          <div key={m.key} style={{ display: 'flex', alignItems: 'center', minHeight: 34 }}>
            <div style={{ width: LABEL_W, flexShrink: 0, paddingRight: 12, lineHeight: 1.2 }}>
              <div style={{ fontSize: 13 }}>{m.name}</div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {num(m.totalQty)} {m.unit}
              </Text>
            </div>
            <div
              style={{
                position: 'relative', flex: 1, height: 26,
                background: 'linear-gradient(#fafafa,#fafafa) center/100% 2px no-repeat',
              }}
            >
              {m.schedule.map((s, i) => {
                const p = posOf(s.date);
                return (
                  <Tooltip key={`${s.date}-${i}`} title={`${fmtDate(s.date)}: ${num(s.qty)} ${m.unit}`}>
                    <Tag
                      color="blue"
                      style={{
                        position: 'absolute', top: 2, left: `${p}%`, transform: `translateX(${shiftOf(p)})`,
                        margin: 0, cursor: 'default',
                      }}
                    >
                      {num(s.qty)}
                    </Tag>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
