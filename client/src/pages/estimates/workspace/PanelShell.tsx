import type { ReactNode, Ref } from 'react';

interface Props {
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  extra?: ReactNode;
  /** Закреплённая строка (фильтры) между шапкой и скроллом — не уезжает при прокрутке тела. */
  toolbar?: ReactNode;
  /** Если true — тело без внутреннего padding (например, для своего Splitter). */
  flush?: boolean;
  /** Ref на скроллящееся тело — нужен как root для IntersectionObserver (ленивый рендер сметы). */
  bodyRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}

// Универсальная панель workspace: фиксированная шапка (+ опц. тулбар) + независимо скроллящееся тело.
export function PanelShell({ icon, title, meta, extra, toolbar, flush, bodyRef, children }: Props) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        background: '#fff',
        border: '1px solid #f0f0f0',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '9px 13px',
          borderBottom: '1px solid #f0f0f0',
          background: '#fafbfc',
          fontWeight: 600,
          fontSize: 13.5,
        }}
      >
        {icon && <span style={{ color: '#8c8c8c' }}>{icon}</span>}
        <span>{title}</span>
        {meta && (
          <span style={{ marginLeft: 'auto', fontWeight: 400, color: '#8c8c8c', fontSize: 12.5 }}>
            {meta}
          </span>
        )}
        {extra}
      </div>
      {toolbar && (
        <div
          style={{
            flexShrink: 0,
            padding: '10px 12px',
            borderBottom: '1px solid #f0f0f0',
            background: '#fff',
          }}
        >
          {toolbar}
        </div>
      )}
      <div
        ref={bodyRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: flush ? 'hidden' : 'auto',
          padding: flush ? 0 : 12,
        }}
      >
        {children}
      </div>
    </div>
  );
}
