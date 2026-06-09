import { useEffect, useRef } from 'react';
import { Empty } from 'antd';
import type { ChatMessage } from './types';

interface Props {
  messages: ChatMessage[];
}

export function AiMessageList({ messages }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          alignSelf: 'center',
          color: '#8c8c8c',
          fontSize: 12,
          background: '#fffbe6',
          border: '1px solid #ffe58f',
          borderRadius: 6,
          padding: '4px 10px',
        }}
      >
        ⚙ Раздел в разработке — реальные запросы к модели появятся позже
      </div>

      {messages.length === 0 ? (
        <Empty
          description="Опишите задачу для ИИ-ассистента"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ margin: 'auto 0' }}
        />
      ) : (
        messages.map((m) => (
          <div
            key={m.id}
            style={{
              maxWidth: '86%',
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              background: m.role === 'user' ? '#1677ff' : '#fafafa',
              color: m.role === 'user' ? '#fff' : 'inherit',
              border: m.role === 'user' ? 'none' : '1px solid #f0f0f0',
              borderRadius: 12,
              borderBottomRightRadius: m.role === 'user' ? 4 : 12,
              borderBottomLeftRadius: m.role === 'user' ? 12 : 4,
              padding: '9px 12px',
              fontSize: 13.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 3 }}>
              {m.role === 'user' ? 'Вы' : 'ИИ-ассистент'}
            </div>
            {m.text}
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}
