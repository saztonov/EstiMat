import { useState } from 'react';
import { Button, Checkbox, Input, Radio, Space, Spin, Typography, App } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AppSettingsResponse, UpdateAppSettingsInput } from '@estimat/shared';
import { api } from '../../services/api';
import { useAppSettings } from '../../hooks/useAppSettings';

// Вкладка «Настройки»: глобальные переключатели приложения.
export function SettingsPanel() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAppSettings();
  const [newModel, setNewModel] = useState('');

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
  const models = settings?.aiModels ?? [];
  const defaultModel = settings?.aiModelDefault ?? '';
  const chatModel = settings?.aiChatModelDefault ?? '';

  function addModel() {
    const id = newModel.trim();
    setNewModel('');
    if (!id || models.includes(id)) return;
    const next = [...models, id];
    // Первая добавленная модель становится дефолтом РД и чата, если он ещё не задан.
    const patch: UpdateAppSettingsInput = { aiModels: next };
    if (!defaultModel) patch.aiModelDefault = id;
    if (!chatModel) patch.aiChatModelDefault = id;
    updateMutation.mutate(patch);
  }

  function removeModel(id: string) {
    const next = models.filter((m) => m !== id);
    const patch: UpdateAppSettingsInput = { aiModels: next };
    if (defaultModel === id) patch.aiModelDefault = next[0] ?? '';
    if (chatModel === id) patch.aiChatModelDefault = next[0] ?? '';
    updateMutation.mutate(patch);
  }

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

      <Typography.Title level={5}>ИИ-извлечение из РД</Typography.Title>
      <Typography.Paragraph style={{ marginBottom: 8 }}>Источник справочника для сопоставления</Typography.Paragraph>
      <Radio.Group
        disabled={updateMutation.isPending}
        value={settings?.aiCatalogSource ?? 'v2_first'}
        onChange={(e) => updateMutation.mutate({ aiCatalogSource: e.target.value })}
        optionType="button"
        buttonStyle="solid"
        options={[
          { label: 'Сначала из ВОР, затем старый', value: 'v2_first' },
          { label: 'Только старый', value: 'legacy' },
          { label: 'Оба', value: 'both' },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 4 }}>
        Какой справочник использует ИИ-агент при сопоставлении извлечённых из РД работ и материалов.
        Цена подставляется из выбранного справочника, если она там есть.
      </Typography.Paragraph>

      <Typography.Title level={5}>Модели ИИ</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 8 }}>
        Список доступных моделей (id OpenRouter). Ниже отдельно выбираются модель для
        ИИ-извлечения из РД и модель для ИИ-ассистента в режиме чата — они могут совпадать
        или различаться.
      </Typography.Paragraph>
      <Space direction="vertical" style={{ width: '100%' }}>
        {models.length === 0 && (
          <Typography.Text type="secondary">Список моделей пуст — добавьте модель ниже.</Typography.Text>
        )}
        {models.map((m) => (
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

      {models.length > 0 && (
        <>
          <Typography.Title level={5}>Модель для извлечения РД</Typography.Title>
          <Radio.Group
            value={defaultModel}
            disabled={updateMutation.isPending}
            onChange={(e) => updateMutation.mutate({ aiModelDefault: e.target.value })}
          >
            <Space direction="vertical">
              {models.map((m) => (
                <Radio key={m} value={m}>{m}</Radio>
              ))}
            </Space>
          </Radio.Group>

          <Typography.Title level={5}>Модель для ИИ-чата</Typography.Title>
          <Radio.Group
            value={chatModel}
            disabled={updateMutation.isPending}
            onChange={(e) => updateMutation.mutate({ aiChatModelDefault: e.target.value })}
          >
            <Space direction="vertical">
              {models.map((m) => (
                <Radio key={m} value={m}>{m}</Radio>
              ))}
            </Space>
          </Radio.Group>
        </>
      )}
    </div>
  );
}
