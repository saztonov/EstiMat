import { useState } from 'react';
import { App, Popover, Button, Badge, Input, Typography, Spin, Popconfirm, Space } from 'antd';
import { MailOutlined, EditOutlined, DeleteOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../../store/authStore';
import { getComments, addComment, updateComment, deleteComment } from '../../../services/estimateComments';
import type { CommentTargetType, EstimateComment } from '@estimat/shared';

interface Props {
  estimateId: string;
  targetType: CommentTargetType;
  targetId: string;
  /** Кол-во комментариев (для бейджа) — из детализации сметы. */
  count?: number;
}

const fmt = (s: string) => new Date(s).toLocaleString('ru-RU');

// Комментарии (примечания) к работе или виду работ. Иконка-конверт с бейджем количества;
// по клику — Popover 500px: лента (newest-first) + добавление/редактирование/удаление.
// Тексты грузятся лениво при открытии; бейдж-счётчик приходит из детализации сметы.
export function CommentsPopover({ estimateId, targetType, targetId, count }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const queryKey = ['estimate-comments', estimateId, targetType, targetId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => getComments(estimateId, targetType, targetId),
    enabled: open,
  });
  const comments = data?.data ?? [];

  // Инвалидация: сама лента + детализация сметы (бейдж-счётчик приходит из detail).
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
    queryClient.invalidateQueries({ queryKey: ['project-estimate'] });
  };

  const addM = useMutation({
    mutationFn: (body: string) => addComment(estimateId, { targetType, targetId, body }),
    onSuccess: () => { setDraft(''); invalidate(); },
    onError: (e: Error) => message.error(e.message),
  });
  const updateM = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => updateComment(id, body),
    onSuccess: () => { setEditingId(null); invalidate(); },
    onError: (e: Error) => message.error(e.message),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: () => invalidate(),
    onError: (e: Error) => message.error(e.message),
  });

  const canModify = (c: EstimateComment) => user?.role === 'admin' || c.createdBy === user?.id;

  const submitAdd = () => {
    const b = draft.trim();
    if (b) addM.mutate(b);
  };
  const submitEdit = () => {
    const b = editingText.trim();
    if (b && editingId) updateM.mutate({ id: editingId, body: b });
  };

  const content = (
    <div style={{ width: '100%' }}>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '12px 0' }}><Spin size="small" /></div>
      ) : comments.length === 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>Пока нет комментариев</Typography.Text>
      ) : (
        <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comments.map((c) =>
            editingId === c.id ? (
              <div key={c.id}>
                <Input.TextArea
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  maxLength={2000}
                  autoFocus
                />
                <Space size={4} style={{ marginTop: 4 }}>
                  <Button type="primary" size="small" icon={<CheckOutlined />} loading={updateM.isPending} onClick={submitEdit} />
                  <Button size="small" icon={<CloseOutlined />} onClick={() => setEditingId(null)} />
                </Space>
              </div>
            ) : (
              <div key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {c.createdByName ?? '—'} · {fmt(c.createdAt)}
                  </Typography.Text>
                </div>
                {canModify(c) && (
                  <Space size={0}>
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => { setEditingId(c.id); setEditingText(c.body); }}
                    />
                    <Popconfirm title="Удалить комментарий?" okText="Да" cancelText="Нет" onConfirm={() => deleteM.mutate(c.id)}>
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                )}
              </div>
            ),
          )}
        </div>
      )}

      <Input.TextArea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Добавить комментарий… (Ctrl+Enter — отправить)"
        autoSize={{ minRows: 2, maxRows: 6 }}
        maxLength={2000}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submitAdd();
          }
        }}
      />
      <div style={{ textAlign: 'right', marginTop: 6 }}>
        <Button type="primary" size="small" loading={addM.isPending} disabled={!draft.trim()} onClick={submitAdd}>
          Добавить
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={(o) => { setOpen(o); if (!o) setEditingId(null); }}
      title="Комментарии"
      content={content}
      overlayStyle={{ width: 500, maxWidth: '90vw' }}
    >
      <Badge count={count ?? 0} size="small">
        <Button type="text" size="small" icon={<MailOutlined />} title="Комментарии" />
      </Badge>
    </Popover>
  );
}
