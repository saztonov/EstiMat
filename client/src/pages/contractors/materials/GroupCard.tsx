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
  /** «N поз.» и прочие подписи — в той же кликабельной шапке, сразу за названием. */
  meta?: ReactNode;
  /** Классификация блока (вид работ, корпуса) — у правого края шапки, до области действий. */
  right?: ReactNode;
  /** Действия справа: набор в заявку, дата поставки. Клик по ним шапку не сворачивает —
   *  antd рендерит extra отдельно от заголовка, поэтому stopPropagation не нужен. */
  extra?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  /** Строится только у развёрнутого блока: групп на экране сотни, и разом это сотни таблиц. */
  children: ReactNode;
}

export function GroupCard({ title, meta, right, extra, collapsed, onToggle, children }: Props) {
  const { token } = theme.useToken();
  return (
    <Card
      size="small"
      style={{ marginBottom: 8 }}
      styles={{
        header: {
          background: token.colorFillAlter,
          // У свёрнутого блока тело пустое, и линия шапки висела бы над пустотой.
          borderBottom: collapsed ? 'none' : undefined,
        },
        // Шапка Card по умолчанию однострочная с многоточием — теги и пояснение обрезались бы.
        // minWidth: 0 — чтобы длинное название сжималось, а не распирало шапку под правой зоной.
        title: { whiteSpace: 'normal', overflow: 'visible', minWidth: 0 },
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
          {/* Левая зона: чем блок является. Сжимается первой — правая держит теги. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              flex: '1 1 auto',
              minWidth: 0,
            }}
          >
            {collapsed ? <RightOutlined style={{ fontSize: 11 }} /> : <DownOutlined style={{ fontSize: 11 }} />}
            {title}
            {meta}
          </div>
          {/* Правая зона прижата авто-отступом: при нехватке ширины она переносится на вторую
              строку целиком и остаётся у правого края, а не рвётся между тегами. */}
          {right && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 4,
                flexWrap: 'wrap',
                flex: '0 1 auto',
                maxWidth: '100%',
                marginInlineStart: 'auto',
              }}
            >
              {right}
            </div>
          )}
        </div>
      }
      extra={extra}
    >
      {!collapsed && children}
    </Card>
  );
}
