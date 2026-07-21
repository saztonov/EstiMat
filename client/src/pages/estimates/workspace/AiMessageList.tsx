import { useEffect, useMemo, useRef } from 'react';
import { Alert, Button, Space, Spin, Tag, Typography } from 'antd';
import type { ApplyItem, ChatMessage } from '@estimat/shared';
import { AiToolCallCard } from './AiToolCallCard';
import { AiCandidateCards } from './AiCandidateCards';

const EXAMPLES = [
  'Добавь работы по устройству кровли',
  'Подбери материалы для штукатурки фасада',
  'Найди похожие сметы по фасаду',
  'Посчитай площадь стяжки для комнаты 5×4',
];

interface Props {
  messages: ChatMessage[];
  applying: boolean;
  onApplyItems: (items: ApplyItem[]) => void;
  onApplySection: (sourceEstimateId: string, costTypeId: string) => void;
  onExampleClick: (text: string) => void;
}

export function AiMessageList({ messages, applying, onApplyItems, onApplySection, onExampleClick }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  // Скролл при изменении числа сообщений и при росте шагов/карточек активного хода.
  const signature = useMemo(
    () => messages.map((m) => `${m.id}:${m.status}:${m.steps.length}:${m.cards.length}`).join('|'),
    [messages],
  );
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [signature]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {messages.length === 0 ? (
        <div style={{ margin: 'auto 0', textAlign: 'center' }}>
          <Typography.Paragraph type="secondary">Опишите задачу ИИ-ассистенту</Typography.Paragraph>
          <Space direction="vertical" style={{ width: '100%' }}>
            {EXAMPLES.map((ex) => (
              <Tag
                key={ex}
                color="blue"
                style={{ cursor: 'pointer', whiteSpace: 'normal', padding: '4px 10px' }}
                onClick={() => onExampleClick(ex)}
              >
                {ex}
              </Tag>
            ))}
          </Space>
        </div>
      ) : (
        messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} style={userBubble}>
              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 3 }}>Вы</div>
              {m.content}
            </div>
          ) : (
            <div key={m.id} style={assistantBubble}>
              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 3 }}>ИИ-ассистент</div>

              {m.steps.length > 0 && (
                <div style={{ marginBottom: m.content ? 8 : 0 }}>
                  {m.steps.map((s) => (
                    <AiToolCallCard key={s.id} step={s} />
                  ))}
                </div>
              )}

              {m.status === 'running' && !m.content && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--est-text-secondary)', fontSize: 12.5 }}>
                  <Spin size="small" /> агент работает…
                </div>
              )}

              {m.content && <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}

              {m.cards.map((card, i) => (
                <AiCandidateCards
                  key={i}
                  card={card}
                  applying={applying}
                  onApplyItems={onApplyItems}
                  onApplySection={onApplySection}
                />
              ))}

              {m.status === 'failed' && (
                <Alert type="error" showIcon style={{ marginTop: 8 }} message={m.error ?? 'Ошибка ИИ-ассистента'} />
              )}
              {m.status === 'cancelled' && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>Остановлено</Typography.Text>
              )}
            </div>
          ),
        )
      )}
      <div ref={endRef} />
    </div>
  );
}

const userBubble: React.CSSProperties = {
  maxWidth: '86%',
  alignSelf: 'flex-end',
  background: 'var(--est-primary)',
  color: '#fff',
  borderRadius: 12,
  borderBottomRightRadius: 4,
  padding: '9px 12px',
  fontSize: 13.5,
  whiteSpace: 'pre-wrap',
};

const assistantBubble: React.CSSProperties = {
  maxWidth: '94%',
  alignSelf: 'flex-start',
  background: 'var(--est-bg-subtle)',
  border: '1px solid var(--est-border)',
  borderRadius: 12,
  borderBottomLeftRadius: 4,
  padding: '9px 12px',
  fontSize: 13.5,
};
