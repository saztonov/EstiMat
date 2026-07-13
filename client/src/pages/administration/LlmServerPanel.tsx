import { useState } from 'react';
import { App, Button, Input, Space, Spin, Switch, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AppSettingsResponse,
  LlmConnectionResponse,
  LlmModelInfo,
  LlmModelsResponse,
  UpdateAppSettingsInput,
} from '@estimat/shared';
import { api } from '../../services/api';
import { useAppSettings } from '../../hooks/useAppSettings';
import { getLlmConnection, getLlmModels, refreshLlmModels, updateLlmConnection } from '../../services/llm';
import { useColumnSearch, uniqueFilters } from '../../lib/tableColumnSearch';

// Вкладка «Сервер моделей»: подключение к LM Studio (адрес — в БД, токен — в env),
// живой каталог моделей и режим Qwen /no_think.
export function LlmServerPanel() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [draftUrl, setDraftUrl] = useState<string | undefined>(undefined);
  const { getColumnSearchProps } = useColumnSearch<LlmModelInfo>();

  const connQuery = useQuery({
    queryKey: ['llm-connection'],
    queryFn: getLlmConnection,
    retry: false,
  });
  const modelsQuery = useQuery({
    queryKey: ['llm-models'],
    queryFn: getLlmModels,
    retry: false,
  });
  const { data: settingsData } = useAppSettings();

  const saveUrl = useMutation({
    mutationFn: (baseUrl: string) => updateLlmConnection({ baseUrl }),
    onSuccess: (res: LlmConnectionResponse) => {
      queryClient.setQueryData(['llm-connection'], res);
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
      setDraftUrl(undefined);
      message.success('Адрес сохранён. Обновите каталог моделей.');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : 'Не удалось сохранить адрес'),
  });

  const refresh = useMutation({
    mutationFn: refreshLlmModels,
    onSuccess: (res: LlmModelsResponse) => {
      queryClient.setQueryData(['llm-models'], res);
      queryClient.invalidateQueries({ queryKey: ['llm-connection'] });
      if (res.reachable) message.success(`Связь есть, моделей: ${res.data.length}`);
      else message.error(res.error || 'Сервер недоступен');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : 'Не удалось обновить каталог'),
  });

  const settingsMutation = useMutation({
    mutationFn: (values: UpdateAppSettingsInput) => api.put<AppSettingsResponse>('/settings', values),
    onSuccess: (res) => {
      queryClient.setQueryData(['app-settings'], res);
      message.success('Настройки сохранены');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : 'Не удалось сохранить настройки'),
  });

  if (connQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  const conn = connQuery.data?.data;
  const urlValue = draftUrl ?? conn?.baseUrl ?? '';
  const sourceLabel =
    conn?.baseUrlSource === 'db' ? 'из настроек' : conn?.baseUrlSource === 'env' ? 'из env (по умолчанию)' : 'не задан';
  const qwenNoThink = settingsData?.data.aiQwenNoThink ?? true;

  const models = modelsQuery.data?.data ?? [];
  const columns: ColumnsType<LlmModelInfo> = [
    {
      title: 'Модель (id)',
      dataIndex: 'id',
      sorter: (a, b) => (a.id || '').localeCompare(b.id || ''),
      ...getColumnSearchProps((r) => r.id),
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: 'Тип',
      dataIndex: 'type',
      width: 120,
      sorter: (a, b) => (a.type || '').localeCompare(b.type || ''),
      filters: uniqueFilters(models, (r) => r.type),
      onFilter: (value, record) => record.type === value,
      render: (v?: string) => v || '—',
    },
    {
      title: 'Контекст',
      dataIndex: 'contextLength',
      width: 120,
      sorter: (a, b) => (a.contextLength ?? 0) - (b.contextLength ?? 0),
      render: (v?: number) => (typeof v === 'number' ? v.toLocaleString('ru-RU') : '—'),
    },
    {
      title: 'Состояние',
      dataIndex: 'state',
      width: 130,
      sorter: (a, b) => (a.state || '').localeCompare(b.state || ''),
      filters: uniqueFilters(models, (r) => r.state),
      onFilter: (value, record) => record.state === value,
      render: (v?: string) =>
        v ? <Tag color={v === 'loaded' ? 'green' : 'default'}>{v}</Tag> : '—',
    },
    {
      title: 'Издатель',
      dataIndex: 'publisher',
      width: 160,
      sorter: (a, b) => (a.publisher || '').localeCompare(b.publisher || ''),
      ...getColumnSearchProps((r) => r.publisher),
      render: (v?: string) => v || '—',
    },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ padding: '16px 0', maxWidth: 820 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Подключение
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 8 }}>
        Адрес OpenAI-совместимого сервера моделей LM Studio (включая путь <Typography.Text code>/v1</Typography.Text>).
        Токен доступа задаётся переменной окружения <Typography.Text code>LMSTUDIO_API_KEY</Typography.Text> и через
        интерфейс не отображается и не изменяется.
      </Typography.Paragraph>

      <Space.Compact style={{ width: '100%', maxWidth: 620 }}>
        <Input
          placeholder="https://host/v1"
          value={urlValue}
          onChange={(e) => setDraftUrl(e.target.value)}
          disabled={saveUrl.isPending}
        />
        <Button
          type="primary"
          onClick={() => saveUrl.mutate(urlValue.trim())}
          loading={saveUrl.isPending}
          disabled={!urlValue.trim() || urlValue.trim() === conn?.baseUrl}
        >
          Сохранить адрес
        </Button>
      </Space.Compact>

      <div style={{ marginTop: 10, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>
          Адрес: <Typography.Text type="secondary">{sourceLabel}</Typography.Text>
        </span>
        <span>
          Токен:{' '}
          {conn?.tokenConfigured ? <Tag color="green">задан</Tag> : <Tag color="red">не задан</Tag>}
        </span>
        <span>
          Готовность:{' '}
          {conn?.enabled ? <Tag color="green">готов</Tag> : <Tag color="orange">не настроен</Tag>}
        </span>
      </div>

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        Каталог моделей
      </Typography.Title>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          Список моделей, доступных на сервере. Обновите, чтобы получить актуальные данные и сделать модели выбираемыми
          в разделе «Настройки».
        </Typography.Text>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => refresh.mutate()}
          loading={refresh.isPending}
          disabled={!conn?.enabled}
        >
          Проверить связь / обновить
        </Button>
      </div>
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={models}
        loading={modelsQuery.isLoading}
        pagination={false}
        scroll={{ x: 700 }}
        locale={{ emptyText: 'Каталог пуст — нажмите «Проверить связь / обновить».' }}
      />

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        Параметры Qwen
      </Typography.Title>
      <Space>
        <Switch
          checked={qwenNoThink}
          loading={settingsMutation.isPending}
          onChange={(checked) => settingsMutation.mutate({ aiQwenNoThink: checked })}
        />
        <span>Режим без рассуждений (/no_think)</span>
      </Space>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 6 }}>
        Для «думающих» моделей Qwen ускоряет ответ и снижает риск пустого ответа в чате/извлечении. Отключите, если
        нужны развёрнутые рассуждения.
      </Typography.Paragraph>
      </div>
    </div>
  );
}
