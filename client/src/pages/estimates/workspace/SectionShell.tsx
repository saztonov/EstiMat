import type { ReactNode } from 'react';
import { CaretRightOutlined, CaretDownOutlined } from '@ant-design/icons';

interface Props {
  title: ReactNode;
  meta?: ReactNode;
  /** Сворачиваемость: если задан onToggle — шапка кликабельна с кареткой. */
  collapsed?: boolean;
  onToggle?: () => void;
  /** Нескроллящаяся полоса под шапкой (напр. поле поиска) — остаётся на месте при прокрутке тела. */
  toolbar?: ReactNode;
  children: ReactNode;
}

// Секция справочника: фиксированная мини-шапка + необязательный toolbar +
// независимо скроллящееся тело. Если передан onToggle — секция сворачивается
// аккордеоном (тело и toolbar скрываются, остаётся только заголовок с кареткой).
export function SectionShell({ title, meta, collapsed, onToggle, toolbar, children }: Props) {
  const collapsible = !!onToggle;
  return (
    <div
      style={{
        height: collapsible && collapsed ? 'auto' : '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        onClick={onToggle}
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          background: '#fafbfc',
          borderBottom: '1px solid #f0f0f0',
          fontWeight: 600,
          fontSize: 13,
          cursor: collapsible ? 'pointer' : 'default',
          userSelect: collapsible ? 'none' : 'auto',
        }}
      >
        {collapsible &&
          (collapsed ? (
            <CaretRightOutlined style={{ color: '#8c8c8c', fontSize: 12 }} />
          ) : (
            <CaretDownOutlined style={{ color: '#8c8c8c', fontSize: 12 }} />
          ))}
        <span>{title}</span>
        {meta && (
          <span style={{ marginLeft: 'auto', fontWeight: 400, color: '#8c8c8c', fontSize: 12 }}>{meta}</span>
        )}
      </div>
      {!(collapsible && collapsed) && toolbar && (
        <div
          style={{
            flexShrink: 0,
            padding: '8px 10px',
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          {toolbar}
        </div>
      )}
      {!(collapsible && collapsed) && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 10px' }}>{children}</div>
      )}
    </div>
  );
}
