import { useEffect, useState } from 'react';
import { App, Button, Popover, Space, Typography } from 'antd';
import { ApartmentOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_GROUPING_SETTINGS,
  type AppSettingsResponse,
  type GroupingSettings,
  type UpdateAppSettingsInput,
} from '@estimat/shared';
import { api } from '../../services/api';
import { useAppSettings } from '../../hooks/useAppSettings';
import { LevelSwitches } from '../contractors/materials/MaterialGroupingPopover';

/**
 * Параметры умной группировки — общие для всех.
 *
 * Результат группировки один на смету, поэтому границы групп задаёт администратор, а не каждый
 * пользователь у себя во вкладке. Переключатели те же, что в стандартной группировке
 * (LevelSwitches) — подписи и подсказки не дублируем.
 */
export function GroupingLevelsPopover() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data } = useAppSettings();
  const saved = data?.data.materialGroupingLevels ?? DEFAULT_GROUPING_SETTINGS;
  const [draft, setDraft] = useState<GroupingSettings>(saved);

  // Пока настройки грузятся, saved — дефолт; подхватываем серверное значение, когда придёт.
  useEffect(() => setDraft(saved), [saved.costType, saved.location, saved.locationType]);

  const mutation = useMutation({
    mutationFn: (values: UpdateAppSettingsInput) => api.put<AppSettingsResponse>('/settings', values),
    onSuccess: (res) => {
      queryClient.setQueryData(['app-settings'], res);
      message.success('Параметры группировки сохранены');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : 'Не удалось сохранить параметры'),
  });

  const dirty =
    draft.costType !== saved.costType ||
    draft.location !== saved.location ||
    draft.locationType !== saved.locationType;

  const content = (
    <Space direction="vertical" size="middle" style={{ width: 300 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Границы групп для ИИ. Действуют для всех пользователей: группировка одна на смету.
        Готовые результаты станут устаревшими и пересчитаются автоматически.
      </Typography.Text>
      <LevelSwitches
        value={draft}
        disabled={mutation.isPending}
        onToggle={(key, v) => setDraft((d) => ({ ...d, [key]: v }))}
      />
      <Space>
        <Button
          type="primary"
          size="small"
          loading={mutation.isPending}
          disabled={!dirty}
          onClick={() => mutation.mutate({ materialGroupingLevels: draft })}
        >
          Сохранить
        </Button>
        <Button size="small" disabled={!dirty || mutation.isPending} onClick={() => setDraft(saved)}>
          Отмена
        </Button>
      </Space>
    </Space>
  );

  return (
    <Popover trigger="click" placement="bottomLeft" title="Параметры умной группировки" content={content}>
      <Button icon={<ApartmentOutlined />}>Параметры умной группировки</Button>
    </Popover>
  );
}
