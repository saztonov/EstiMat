import { useEffect, useState } from 'react';
import { Input, Button, Space, Tag, Typography, Popconfirm, App } from 'antd';
import { SendOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { COMMENT_RECIPIENT_LABELS, type CommentRecipient } from '@estimat/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

const { Text } = Typography;
const { TextArea } = Input;

interface RequestComment {
  id: string;
  author_id: string | null;
  author_name: string | null;
  author_role: string | null;
  text: string;
  recipient: string | null;
  created_at: string;
  updated_at: string | null;
}

const INTERNAL = new Set(['admin', 'engineer', 'manager']);

/** Чат общения по заявке (подрядчик ↔ снабжение). Лента новых сверху, адресат, отправка по Enter. */
export function CommentsChat({ requestId }: { requestId: string }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['requests', 'comments', requestId],
    queryFn: () => api.get<{ data: RequestComment[] }>(`/requests/${requestId}/comments`),
    enabled: !!requestId,
  });
  const comments = data?.data ?? [];

  // Отметить прочитанным при открытии.
  useEffect(() => {
    if (!requestId) return;
    api.post(`/requests/${requestId}/comments/mark-read`)
      .then(() => qc.invalidateQueries({ queryKey: ['requests', 'unread-counts'] }))
      .catch(() => { /* тихо */ });
  }, [requestId, qc]);

  const refetch = () => qc.invalidateQueries({ queryKey: ['requests', 'comments', requestId] });

  async function send() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      await api.post(`/requests/${requestId}/comments`, { text: t, recipient: null });
      setText('');
      refetch();
    } catch (e) { message.error((e as Error).message); }
    finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      await api.put(`/requests/comments/${editing.id}`, { text: editing.text });
      setEditing(null);
      refetch();
    } catch (e) { message.error((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    try { await api.delete(`/requests/comments/${id}`); refetch(); }
    catch (e) { message.error((e as Error).message); }
  }

  // Право правки/удаления: свой последний комментарий или admin.
  const canModify = (c: RequestComment) =>
    isAdmin || (comments[0]?.id === c.id && c.author_id === user?.id);

  const authorSide = (role: string | null) => (role && INTERNAL.has(role) ? 'Снабжение' : 'Подрядчик');

  return (
    <div>
      <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--est-border)', borderRadius: 6, background: 'var(--est-bg-subtle)', padding: 8, marginBottom: 12 }}>
        {isLoading ? (
          <Text type="secondary">Загрузка…</Text>
        ) : comments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 16 }}><Text type="secondary">Сообщений пока нет</Text></div>
        ) : (
          comments.map((c) => (
            <div key={c.id} style={{ background: 'var(--est-bg-container)', border: '1px solid var(--est-border)', borderRadius: 6, padding: '8px 12px', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text strong>{c.author_name || authorSide(c.author_role)}</Text>
                {c.recipient && <Tag color="blue">{COMMENT_RECIPIENT_LABELS[c.recipient as CommentRecipient] ?? c.recipient}</Tag>}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {dayjs(c.created_at).format('DD.MM.YYYY HH:mm')}{c.updated_at ? ' (ред.)' : ''}
                </Text>
                {canModify(c) && (
                  <Space size={4} style={{ marginLeft: 'auto' }}>
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing({ id: c.id, text: c.text })} />
                    <Popconfirm title="Удалить комментарий?" onConfirm={() => remove(c.id)}>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                )}
              </div>
              {editing?.id === c.id ? (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <TextArea value={editing.text} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} autoSize={{ minRows: 1, maxRows: 4 }} />
                  <Space>
                    <Button size="small" type="primary" loading={busy} onClick={saveEdit}>Сохранить</Button>
                    <Button size="small" onClick={() => setEditing(null)}>Отмена</Button>
                  </Space>
                </Space>
              ) : (
                <Text style={{ whiteSpace: 'pre-wrap' }}>{c.text}</Text>
              )}
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Написать комментарий… (Enter — отправить)"
          autoSize={{ minRows: 1, maxRows: 3 }}
          style={{ flex: 1 }}
        />
        <Button type="primary" icon={<SendOutlined />} loading={busy} disabled={!text.trim()} onClick={send} />
      </div>
    </div>
  );
}
