import { Input, Select, Button } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { AI_MODELS } from '../../../services/ai';

interface Props {
  model: string;
  input: string;
  loading: boolean;
  onModelChange: (v: string) => void;
  onInputChange: (v: string) => void;
  onRun: () => void;
}

export function AiComposer({ model, input, loading, onModelChange, onInputChange, onRun }: Props) {
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
        placeholder="Опишите задачу для ИИ… (например: подобрать работы по разделу РД)"
        autoSize={{ minRows: 2, maxRows: 5 }}
        onPressEnter={(e) => {
          if (!e.shiftKey) {
            e.preventDefault();
            onRun();
          }
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Select
          size="middle"
          value={model}
          onChange={onModelChange}
          options={AI_MODELS}
          style={{ minWidth: 180 }}
        />
        <span style={{ flex: 1 }} />
        <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={onRun}>
          Пуск
        </Button>
      </div>
    </div>
  );
}
