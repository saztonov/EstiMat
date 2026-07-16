import { useState } from 'react';
import { App, Button, Input, Space, Spin, Tag, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AI_PROMPT_GROUPS,
  AI_PROMPT_MAX_LENGTH,
  type AiPromptGroup,
  type AiPromptId,
  type AiPromptItem,
} from '@estimat/shared';
import { useAiPrompts } from '../../hooks/useAiPrompts';
import { updateAiPrompt } from '../../services/aiPrompts';
import { GroupingLevelsPopover } from './GroupingLevelsPopover';

// Вкладка «Промпты»: редактирование текстов, уходящих в LLM. Только admin (защита на сервере).
export function PromptsPanel() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAiPrompts();
  // Черновики по id: пока промпт не сохранён/сброшен, показываем правку пользователя.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<AiPromptId | null>(null);

  const mutation = useMutation({
    mutationFn: ({ id, value }: { id: AiPromptId; value: string | null }) => updateAiPrompt(id, value),
    onMutate: ({ id }) => setPendingId(id),
    onSuccess: (_res, { id }) => {
      // Сбрасываем черновик — textarea покажет свежее серверное значение.
      setDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['ai-prompts'] });
      message.success('Промпт сохранён');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : 'Не удалось сохранить промпт'),
    onSettled: () => setPendingId(null),
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  const items = data?.data ?? [];
  const byGroup = new Map<AiPromptGroup, AiPromptItem[]>();
  for (const it of items) {
    const arr = byGroup.get(it.group) ?? [];
    arr.push(it);
    byGroup.set(it.group, arr);
  }

  const renderPrompt = (item: AiPromptItem) => {
    const current = drafts[item.id] ?? item.value;
    const dirty = current !== item.value;
    const busy = mutation.isPending && pendingId === item.id;

    const reset = () => {
      modal.confirm({
        title: 'Сбросить к стандартному?',
        content: 'Текст промпта вернётся к встроенному значению по умолчанию.',
        okText: 'Сбросить',
        cancelText: 'Отмена',
        onOk: () => mutation.mutate({ id: item.id, value: null }),
      });
    };

    return (
      <div key={item.id} style={{ marginBottom: 24, maxWidth: 900 }}>
        <Space size={8} style={{ marginBottom: 4, flexWrap: 'wrap' }}>
          <Typography.Text strong>{item.title}</Typography.Text>
          {item.overridden ? <Tag color="orange">Переопределён</Tag> : <Tag>Стандартный</Tag>}
        </Space>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 8 }}>
          {item.description}
        </Typography.Paragraph>
        <Input.TextArea
          value={current}
          autoSize={{ minRows: 6, maxRows: 24 }}
          maxLength={AI_PROMPT_MAX_LENGTH}
          disabled={busy}
          onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
          style={{ fontFamily: 'monospace', fontSize: 12.5 }}
        />
        <Space style={{ marginTop: 8, width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Button
              type="primary"
              size="small"
              loading={busy}
              disabled={!dirty || !current.trim()}
              onClick={() => mutation.mutate({ id: item.id, value: current })}
            >
              Сохранить
            </Button>
            <Button size="small" disabled={busy || !item.overridden} onClick={reset}>
              Сбросить к стандартному
            </Button>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {current.length} / {AI_PROMPT_MAX_LENGTH}
          </Typography.Text>
        </Space>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingTop: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <GroupingLevelsPopover />
      </div>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, maxWidth: 900 }}>
        Тексты промптов, отправляемых в модель. Правки применяются к новым запросам: для умной
        группировки — к заданиям, запущенным после сохранения (готовые результаты остаются как есть).
      </Typography.Paragraph>
      {(Object.keys(AI_PROMPT_GROUPS) as AiPromptGroup[]).map((group) => {
        const groupItems = byGroup.get(group);
        if (!groupItems?.length) return null;
        return (
          <div key={group} style={{ marginBottom: 8 }}>
            <Typography.Title level={5} style={{ marginBottom: 12 }}>
              {AI_PROMPT_GROUPS[group]}
            </Typography.Title>
            {groupItems.map(renderPrompt)}
          </div>
        );
      })}
    </div>
  );
}
