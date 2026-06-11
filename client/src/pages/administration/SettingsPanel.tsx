import { Checkbox, Spin, Typography, App } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AppSettingsResponse, UpdateAppSettingsInput } from '@estimat/shared';
import { api } from '../../services/api';
import { useAppSettings } from '../../hooks/useAppSettings';

// Вкладка «Настройки»: глобальные переключатели приложения.
export function SettingsPanel() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAppSettings();

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
    </div>
  );
}
