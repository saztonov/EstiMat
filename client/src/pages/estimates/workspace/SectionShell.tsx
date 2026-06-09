import type { ReactNode } from 'react';

interface Props {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}

// Секция справочника внутри вертикального Splitter: фиксированная мини-шапка
// + независимо скроллящееся тело.
export function SectionShell({ title, meta, children }: Props) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div
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
        }}
      >
        <span>{title}</span>
        {meta && <span style={{ marginLeft: 'auto', fontWeight: 400, color: '#8c8c8c', fontSize: 12 }}>{meta}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 10px' }}>{children}</div>
    </div>
  );
}
