import { Checkbox, Radio, Space, Spin, Tag, Typography, App } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSettingsResponse, UpdateAppSettingsInput } from '@estimat/shared';
import { api } from '../../services/api';
import { useAppSettings } from '../../hooks/useAppSettings';
import { getLlmConnection } from '../../services/llm';

// Единая опция OpenRouter: конкретная модель на проде задаётся прокси, выбор её в UI не нужен.
const OPENROUTER_VALUE = 'openrouter:';

// Привести сохранённое значение к опции выбора: любой openrouter (или старое «голое»
// значение / пусто) → единая опция «OpenRouter (прокси)»; lmstudio:<id> — как есть.
function toOption(stored: string | undefined): string {
  const v = (stored ?? '').trim();
  return v.startsWith('lmstudio:') ? v : OPENROUTER_VALUE;
}

// Вкладка «Настройки»: переключатели приложения и выбор моделей для РД и для чата.
export function SettingsPanel() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAppSettings();

  // Каталог моделей собственного сервера LM Studio (выбираемы наравне с OpenRouter).
  const connQuery = useQuery({ queryKey: ['llm-connection'], queryFn: getLlmConnection, retry: false });

  const updateMutation = useMutation({
    mutationFn: (values: UpdateAppSettingsInput) => api.put<AppSettingsResponse>('/settings', values),
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
  const lmModels = connQuery.data?.data.models ?? [];

  // Опции выбора: OpenRouter (прокси) + модели LM Studio из каталога.
  const modelOptions: { value: string; label: string; provider: 'OpenRouter' | 'LM Studio' }[] = [
    { value: OPENROUTER_VALUE, label: 'OpenRouter (прокси)', provider: 'OpenRouter' },
    ...lmModels.map((id) => ({ value: `lmstudio:${id}`, label: id, provider: 'LM Studio' as const })),
  ];

  const rdSelected = toOption(settings?.aiModelDefault);
  const chatSelected = toOption(settings?.aiChatModelDefault);

  const renderColumn = (title: string, selected: string, onPick: (value: string) => void) => (
    <div style={{ minWidth: 240 }}>
      <Typography.Title level={5}>{title}</Typography.Title>
      <Radio.Group
        value={selected}
        disabled={updateMutation.isPending}
        onChange={(e) => onPick(e.target.value)}
      >
        <Space direction="vertical">
          {modelOptions.map((o) => (
            <Radio key={o.value} value={o.value}>
              {o.label}
              {o.provider === 'LM Studio' && (
                <Tag color="geekblue" style={{ marginInlineStart: 6 }}>
                  LM Studio
                </Tag>
              )}
            </Radio>
          ))}
        </Space>
      </Radio.Group>
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ padding: '16px 0' }}>
        <div style={{ maxWidth: 760 }}>
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

          <Typography.Title level={5}>Модели ИИ</Typography.Title>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 8 }}>
            Отдельно выбираются модель для ИИ-извлечения из РД и для ИИ-чата. «OpenRouter (прокси)» —
            запросы идут через прокси, конкретную модель задаёт сам прокси. Модели собственного сервера
            (LM Studio) появляются после обновления каталога на вкладке «Сервер моделей».
          </Typography.Paragraph>
        </div>

        {/* Колонки на полной ширине (не ограничены 760), чтобы стоять рядом, а не переноситься. */}
        <div style={{ display: 'flex', gap: 56, flexWrap: 'wrap' }}>
          {renderColumn('Модель для извлечения РД', rdSelected, (value) =>
            updateMutation.mutate({ aiModelDefault: value }),
          )}
          {renderColumn('Модель для ИИ-чата', chatSelected, (value) =>
            updateMutation.mutate({ aiChatModelDefault: value }),
          )}
        </div>
      </div>
    </div>
  );
}
