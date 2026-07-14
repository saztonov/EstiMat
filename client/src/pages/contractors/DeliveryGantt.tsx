import type { CSSProperties } from 'react';
import { Typography, Tooltip, Empty, Tag } from 'antd';

const { Text } = Typography;

// Материал с графиком поставки для диаграммы. date — 'YYYY-MM-DD' (или ISO — берём первые 10 символов).
export interface GanttMaterial {
  key: string;
  name: string;
  unit: string;
  totalQty: number;
  schedule: { date: string; qty: number }[];
}

const NAME_W = 300; // столбец «Наименование» (с переносом длинных имён)
const QTY_W = 90; // столбец «Кол-во» (общее)
const MIN_TRACK = 420; // минимальная ширина диаграммы
const PX_PER_DAY = 12; // масштаб времени: чем шире диапазон, тем шире трек (→ горизонтальный скролл)
const DAY_MS = 86_400_000;

function parseDate(d: string): number {
  const [y, m, dd] = d.slice(0, 10).split('-');
  return new Date(Number(y), Number(m) - 1, Number(dd)).getTime();
}
function fmtDate(d: string): string {
  const [y, m, dd] = d.slice(0, 10).split('-');
  return `${dd}.${m}.${y}`;
}
const num = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Лёгкая диаграмма Ганта графика поставки (CSS/flex, без внешних библиотек). Слева — столбцы
 * «Наименование» и «Кол-во», справа — трек по общей шкале дат заявки с метками количества на позиции
 * даты. Ширина трека растёт с диапазоном дат (поставка на несколько месяцев переваривается
 * горизонтальным скроллом, метки не налезают и не выходят за модалку). Переиспользуется в окне
 * создания и карточке заявки.
 */
export function DeliveryGantt({ materials }: { materials: GanttMaterial[] }) {
  const withSchedule = materials.filter((m) => m.schedule.length > 0);
  const allDates = Array.from(new Set(withSchedule.flatMap((m) => m.schedule.map((s) => s.date.slice(0, 10))))).sort();
  if (allDates.length === 0)
    return <Empty description="График поставки не задан" image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  const min = parseDate(allDates[0]!);
  const max = parseDate(allDates[allDates.length - 1]!);
  const span = max - min;
  const spanDays = span / DAY_MS;
  const trackW = Math.max(MIN_TRACK, Math.round(spanDays * PX_PER_DAY));
  const posOf = (d: string) => (span > 0 ? ((parseDate(d) - min) / span) * 100 : 50);
  // Крайние метки не должны вылезать за трек.
  const shiftOf = (p: number) => (p <= 1 ? '0' : p >= 99 ? '-100%' : '-50%');

  const colHead: CSSProperties = { fontWeight: 600, fontSize: 12, color: '#595959' };

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <div style={{ minWidth: NAME_W + QTY_W + trackW }}>
        {/* Заголовок столбцов + ось дат */}
        <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 8, borderBottom: '1px solid #f0f0f0', paddingBottom: 4 }}>
          <div style={{ width: NAME_W, flexShrink: 0, ...colHead }}>Наименование</div>
          <div style={{ width: QTY_W, flexShrink: 0, textAlign: 'right', paddingRight: 12, ...colHead }}>Кол-во</div>
          <div style={{ position: 'relative', width: trackW, flexShrink: 0, height: 18 }}>
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
          <div key={m.key} style={{ display: 'flex', alignItems: 'center', minHeight: 34, borderBottom: '1px solid #fafafa' }}>
            <div style={{ width: NAME_W, flexShrink: 0, paddingRight: 12, fontSize: 13, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.25 }}>
              {m.name}
            </div>
            <div style={{ width: QTY_W, flexShrink: 0, textAlign: 'right', paddingRight: 12 }}>
              {num(m.totalQty)} <Text type="secondary" style={{ fontSize: 11 }}>{m.unit}</Text>
            </div>
            <div
              style={{
                position: 'relative', width: trackW, flexShrink: 0, height: 26,
                background: 'linear-gradient(#f0f0f0,#f0f0f0) center/100% 2px no-repeat',
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
