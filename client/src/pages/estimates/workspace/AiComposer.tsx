import { Input, Button } from 'antd';
import { SendOutlined, StopOutlined } from '@ant-design/icons';

interface Props {
  input: string;
  loading: boolean;
  busy: boolean;
  onInputChange: (v: string) => void;
  onRun: () => void;
  onStop?: () => void;
}

export function AiComposer({ input, loading, busy, onInputChange, onRun, onStop }: Props) {
  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: '1px solid #f0f0f0',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: '#fff',
      }}
    >
      <Input.TextArea
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder="Опишите задачу для ИИ… (например: подбери работы по устройству кровли)"
        autoSize={{ minRows: 2, maxRows: 5 }}
        disabled={busy}
        onPressEnter={(e) => {
          if (!e.shiftKey) {
            e.preventDefault();
            onRun();
          }
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1 }} />
        {busy && onStop && (
          <Button danger icon={<StopOutlined />} onClick={onStop}>
            Остановить
          </Button>
        )}
        <Button type="primary" icon={<SendOutlined />} loading={loading} disabled={busy} onClick={onRun}>
          Пуск
        </Button>
      </div>
    </div>
  );
}
