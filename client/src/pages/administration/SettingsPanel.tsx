import { useState } from 'react';
import { Button, Checkbox, Input, Radio, Space, Spin, Tag, Typography, App } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSettingsResponse, UpdateAppSettingsInput } from '@estimat/shared';
import { api } from '../../services/api';
import { useAppSettings } from '../../hooks/useAppSettings';
import { getLlmConnection } from '../../services/llm';

// Квалифицировать выбор модели провайдером. Старое «голое» значение → openrouter.
function qualify(v: string): string {
  if (!v) return '';
  return /^(openrouter|lmstudio):/.test(v) ? v : `openrouter:${v}`;
}

// Вкладка «Настройки»: глобальные переключатели приложения и выбор моделей ИИ.
export function SettingsPanel() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAppSettings();
  const [newModel, setNewModel] = useState('');

  // Каталог моделей LM Studio (для выбора их в качестве модели чата/РД).
  const connQuery = useQuery({ queryKey: ['llm-connection'], queryFn: getLlmConnection, retry: false });

  const updateMutation = useMutation({
    mutationFn: (values: UpdateAppSettingsInput) =>
      api.put<AppSettingsResponse>('/settings', values),
    onSuccess: (res) => {
      queryClient.setQueryData(['app-settings'], res);
      message.success('Настройки сохранены');
    },
    onError: (e) => {
      message.error(e instanceof Error ? e.message : 'Не удалось сохранить настройки');
    },
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  const settings = data?.data;
  const orModels = settings?.aiModels ?? []; // id моделей OpenRouter
  const lmModels = connQuery.data?.data.models ?? []; // id моделей LM Studio (каталог)
  const defaultModel = qualify(settings?.aiModelDefault ?? '');
  const chatModel = qualify(settings?.aiChatModelDefault ?? '');

  // Опции выбора: OpenRouter (из aiModels) + LM Studio (из каталога), квалифицированы провайдером.
  const modelOptions: { value: string; id: string; provider: 'OpenRouter' | 'LM Studio' }[] = [
    ...orModels.map((id) => ({ value: `openrouter:${id}`, id, provider: 'OpenRouter' as const })),
    ...lmModels.map((id) => ({ value: `lmstudio:${id}`, id, provider: 'LM Studio' as const })),
  ];

  function addModel() {
    const id = newModel.trim();
    setNewModel('');
    if (!id || orModels.includes(id)) return;
    const next = [...orModels, id];
    // Первая добавленная модель становится дефолтом РД и чата, если он ещё не задан.
    const patch: UpdateAppSettingsInput = { aiModels: next };
    if (!settings?.aiModelDefault) patch.aiModelDefault = `openrouter:${id}`;
    if (!settings?.aiChatModelDefault) patch.aiChatModelDefault = `openrouter:${id}`;
    updateMutation.mutate(patch);
  }

  function removeModel(id: string) {
    const next = orModels.filter((m) => m !== id);
    const qid = `openrouter:${id}`;
    const patch: UpdateAppSettingsInput = { aiModels: next };
    if (defaultModel === qid) patch.aiModelDefault = next[0] ? `openrouter:${next[0]}` : '';
    if (chatModel === qid) patch.aiChatModelDefault = next[0] ? `openrouter:${next[0]}` : '';
    updateMutation.mutate(patch);
  }

  const renderRadios = (selected: string, onChange: (value: string) => void) => (
    <Radio.Group value={selected} disabled={updateMutation.isPending} onChange={(e) => onChange(e.target.value)}>
      <Space direction="vertical">
        {modelOptions.map((o) => (
          <Radio key={o.value} value={o.value}>
            {o.id}{' '}
            <Tag color={o.provider === 'LM Studio' ? 'geekblue' : 'default'} style={{ marginInlineStart: 4 }}>
              {o.provider}
            </Tag>
          </Radio>
        ))}
      </Space>
    </Radio.Group>
  );

  return (
    <div style={{ padding: '16px 0', maxWidth: 640 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Смета
      </Typography.Title>
      <Checkbox
        checked={settings?.rdSectionEnabled ?? true}
        disabled={updateMutation.isPending}
        onChange={(e) => updateMutation.mutate({ rdSectionEnabled: e.target.checked })}
      >
        Активация блока справочника Рабочая документация
      </Checkbox>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 4, marginLeft: 24 }}>
        При снятии флажка блок «Рабочая документация» скрывается из панели справочников
        в рабочем пространстве сметы у всех пользователей.
      </Typography.Paragraph>

      <Typography.Title level={5}>Модели OpenRouter</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 8 }}>
        Список доступных моделей OpenRouter (id). Модели собственного сервера добавляются на вкладке
        «Сервер моделей». Ниже отдельно выбираются модель для ИИ-извлечения из РД и для ИИ-чата.
      </Typography.Paragraph>
      <Space direction="vertical" style={{ width: '100%' }}>
        {orModels.length === 0 && (
          <Typography.Text type="secondary">Список моделей OpenRouter пуст — добавьте ниже.</Typography.Text>
        )}
        {orModels.map((m) => (
          <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Typography.Text style={{ flex: 1 }}>{m}</Typography.Text>
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              disabled={updateMutation.isPending}
              onClick={() => removeModel(m)}
            />
          </div>
        ))}
      </Space>
      <Space.Compact style={{ marginTop: 8, width: '100%', maxWidth: 480 }}>
        <Input
          placeholder="например, anthropic/claude-opus-4-8"
          value={newModel}
          onChange={(e) => setNewModel(e.target.value)}
          onPressEnter={addModel}
          disabled={updateMutation.isPending}
        />
        <Button onClick={addModel} disabled={updateMutation.isPending || !newModel.trim()}>
          Добавить
        </Button>
      </Space.Compact>

      {modelOptions.length > 0 && (
        <>
          <Typography.Title level={5}>Модель для извлечения РД</Typography.Title>
          {renderRadios(defaultModel, (value) => updateMutation.mutate({ aiModelDefault: value }))}

          <Typography.Title level={5}>Модель для ИИ-чата</Typography.Title>
          {renderRadios(chatModel, (value) => updateMutation.mutate({ aiChatModelDefault: value }))}

          <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 12 }}>
            Выбор определяет, на какой сервер уходит запрос: модели OpenRouter — на OpenRouter/прокси
            (там модель может задавать сам прокси), модели LM Studio — на собственный сервер.
          </Typography.Paragraph>
        </>
      )}
    </div>
  );
}
