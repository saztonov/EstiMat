// Блок группы материалов: шапка + содержимое. Единственная обёртка для умных групп, секций и
// корневых узлов стандартного дерева — раньше эта шапка была скопирована в трёх местах.
//
// Границы блока раньше не читались: заголовки и таблицы шли сплошной лентой, и было не видно, где
// кончается одна группа и начинается другая. Отсюда рамка и залитая шапка.
import type { ReactNode } from 'react';
import { Card, theme } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';

interface Props {
  /** Название блока и теги. */
  title: ReactNode;
  /** Пояснение, «N поз.», сумма — в той же кликабельной шапке. */
  meta?: ReactNode;
  /** Действия справа: набор в заявку, дата поставки. Клик по ним шапку не сворачивает —
   *  antd рендерит extra отдельно от заголовка, поэтому stopPropagation не нужен. */
  extra?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  /** Строится только у развёрнутого блока: групп на экране сотни, и разом это сотни таблиц. */
  children: ReactNode;
}

export function GroupCard({ title, meta, extra, collapsed, onToggle, children }: Props) {
  const { token } = theme.useToken();
  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      styles={{
        header: {
          background: token.colorFillAlter,
          // У свёрнутого блока тело пустое, и линия шапки висела бы над пустотой.
          borderBottom: collapsed ? 'none' : undefined,
        },
        // Шапка Card по умолчанию однострочная с многоточием — теги и пояснение обрезались бы.
        title: { whiteSpace: 'normal', overflow: 'visible' },
        body: { padding: 0 },
      }}
      title={
        <div
          role="button"
          tabIndex={0}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          {collapsed ? <RightOutlined style={{ fontSize: 11 }} /> : <DownOutlined style={{ fontSize: 11 }} />}
          {title}
          {meta}
        </div>
      }
      extra={extra}
    >
      {!collapsed && children}
    </Card>
  );
}
