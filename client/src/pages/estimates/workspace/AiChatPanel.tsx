import { useState } from 'react';
import { Button, Segmented, Tag, Tooltip } from 'antd';
import { RobotOutlined, DoubleRightOutlined } from '@ant-design/icons';
import { AiMessageList } from './AiMessageList';
import { AiComposer } from './AiComposer';
import { AiExtractPanel } from './AiExtractPanel';
import { runInference, DEFAULT_AI_MODEL } from '../../../services/ai';
import type { ChatMessage } from './types';

type AiMode = 'chat' | 'extract';

interface Props {
  estimateId: string;
  onCollapse: () => void;
}

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

// ИИ-ассистент: чат (заглушка) + извлечение работ/материалов из РД.
export function AiChatPanel({ estimateId, onCollapse }: Props) {
  const [aiMode, setAiMode] = useState<AiMode>('extract');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [model, setModel] = useState(DEFAULT_AI_MODEL);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRun() {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg: ChatMessage = { id: newId(), role: 'user', text, ts: Date.now() };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setLoading(true);
    try {
      const reply = await runInference(model, history);
      setMessages((m) => [...m, { id: newId(), role: 'assistant', text: reply, ts: Date.now() }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
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
        <RobotOutlined style={{ color: '#8c8c8c' }} />
        <span>ИИ-ассистент</span>
        <Segmented<AiMode>
          size="small"
          value={aiMode}
          onChange={(v) => setAiMode(v)}
          options={[
            { label: 'Извлечение РД', value: 'extract' },
            { label: 'Чат', value: 'chat' },
          ]}
          style={{ marginInlineStart: 4 }}
        />
        <span style={{ flex: 1 }} />
        <Tooltip title="Свернуть в рельс">
          <Button type="text" size="small" icon={<DoubleRightOutlined />} onClick={onCollapse} />
        </Tooltip>
      </div>

      {aiMode === 'extract' ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <AiExtractPanel estimateId={estimateId} />
        </div>
      ) : (
        <>
          <AiMessageList messages={messages} />
          <AiComposer
            model={model}
            input={input}
            loading={loading}
            onModelChange={setModel}
            onInputChange={setInput}
            onRun={handleRun}
          />
        </>
      )}
    </div>
  );
}
