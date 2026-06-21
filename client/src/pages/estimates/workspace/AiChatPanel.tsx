import { useState } from 'react';
import { App, Button, Popconfirm, Segmented, Select, Tooltip } from 'antd';
import { RobotOutlined, DoubleRightOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApplyItem } from '@estimat/shared';
import { AiMessageList } from './AiMessageList';
import { AiComposer } from './AiComposer';
import { AiExtractPanel } from './AiExtractPanel';
import { WorkScopeSelect } from './WorkScopeSelect';
import {
  listChatSessions,
  createChatSession,
  getChatMessages,
  sendChatMessage,
  applySelected as applySelectedApi,
  applySection as applySectionApi,
  cancelChatTurn,
  deleteChatSession,
} from '../../../services/aiChat';
import { useAiChatStore } from '../../../store/aiChatStore';
import { useEstimateSelectionStore } from '../../../store/estimateSelectionStore';
import { useWorkScopeStore } from '../../../store/workScopeStore';

type AiMode = 'chat' | 'extract';

interface Props {
  estimateId: string;
  onCollapse: () => void;
}

export function AiChatPanel({ estimateId, onCollapse }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [aiMode, setAiMode] = useState<AiMode>('extract');
  const [input, setInput] = useState('');
  const [newChat, setNewChat] = useState(false);

  const { activeSessionByEstimate, setActiveSession } = useAiChatStore();
  const revealEstimateItem = useEstimateSelectionStore((s) => s.revealEstimateItem);
  // Область подбора (разделы/виды) — общая с режимом РД и деревом работ.
  const scopeCategoryIds = useWorkScopeStore((s) => s.categoryIds);
  const scopeCostTypeIds = useWorkScopeStore((s) => s.costTypeIds);

  const sessionsQuery = useQuery({
    queryKey: ['ai-chat-sessions', estimateId],
    queryFn: () => listChatSessions(estimateId),
    enabled: aiMode === 'chat',
  });
  const sessions = sessionsQuery.data?.data ?? [];

  const stored = activeSessionByEstimate[estimateId] ?? null;
  const sessionId = newChat
    ? null
    : stored && sessions.some((s) => s.id === stored)
      ? stored
      : (sessions[0]?.id ?? null);

  const messagesQuery = useQuery({
    queryKey: ['ai-chat-messages', sessionId],
    queryFn: () => getChatMessages(sessionId as string),
    enabled: aiMode === 'chat' && !!sessionId,
    refetchInterval: (q) => ((q.state.data?.data ?? []).some((m) => m.status === 'running') ? 1500 : false),
  });
  const messages = messagesQuery.data?.data ?? [];
  const busy = messages.some((m) => m.status === 'running');
  const runningId = messages.find((m) => m.status === 'running')?.id ?? null;

  const sendMut = useMutation({
    mutationFn: async (text: string) => {
      let sid = sessionId;
      if (!sid) {
        const s = await createChatSession(estimateId);
        sid = s.data.id;
      }
      // Область подбора отправляется только при выбранной категории (иначе — весь справочник).
      const sectionScope = scopeCategoryIds.length
        ? { categoryIds: scopeCategoryIds, costTypeIds: scopeCostTypeIds }
        : undefined;
      const res = await sendChatMessage(sid, text, sectionScope);
      return { sid, res };
    },
    onSuccess: ({ sid }) => {
      setNewChat(false);
      setActiveSession(estimateId, sid);
      setInput('');
      qc.invalidateQueries({ queryKey: ['ai-chat-sessions', estimateId] });
      qc.invalidateQueries({ queryKey: ['ai-chat-messages', sid] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const applyMut = useMutation({
    mutationFn: (items: ApplyItem[]) => applySelectedApi({ chatId: sessionId as string, items, override: false }),
    onSuccess: (res) => {
      const { works, materials } = res.data.added;
      message.success(`Добавлено: работ ${works}, материалов ${materials}`);
      if (res.data.skipped.length) message.info(`Пропущено дублей: ${res.data.skipped.length}`);
      qc.invalidateQueries({ queryKey: ['estimate', estimateId] });
      if (res.data.addedItemIds[0]) revealEstimateItem(res.data.addedItemIds[0]);
    },
    onError: (e: Error) => message.error(e.message),
  });

  const applySectionMut = useMutation({
    mutationFn: (p: { sourceEstimateId: string; costTypeId: string }) =>
      applySectionApi({ chatId: sessionId as string, sourceEstimateId: p.sourceEstimateId, costTypeId: p.costTypeId, override: false }),
    onSuccess: (res) => {
      message.success(`Скопировано работ: ${res.data.added.works}`);
      qc.invalidateQueries({ queryKey: ['estimate', estimateId] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (sid: string) => deleteChatSession(sid),
    onSuccess: () => {
      setActiveSession(estimateId, null);
      qc.invalidateQueries({ queryKey: ['ai-chat-sessions', estimateId] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  function handleRun() {
    const text = input.trim();
    if (!text || busy || sendMut.isPending) return;
    sendMut.mutate(text);
  }

  function handleStop() {
    if (runningId) cancelChatTurn(runningId).then(() => qc.invalidateQueries({ queryKey: ['ai-chat-messages', sessionId] }));
  }

  return (
    <div style={panelBox}>
      <div style={header}>
        <RobotOutlined style={{ color: '#8c8c8c' }} />
        <span>ИИ-ассистент</span>
        <Segmented<AiMode>
          size="small"
          value={aiMode}
          onChange={(v) => setAiMode(v)}
          options={[
            { label: 'Извлечение РД', value: 'extract' },
            { label: 'Чат', value: 'chat' },
          ]}
          style={{ marginInlineStart: 4 }}
        />
        <span style={{ flex: 1 }} />
        <Tooltip title="Свернуть в рельс">
          <Button type="text" size="small" icon={<DoubleRightOutlined />} onClick={onCollapse} />
        </Tooltip>
      </div>

      {aiMode === 'extract' ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <AiExtractPanel estimateId={estimateId} />
        </div>
      ) : (
        <>
          <div style={sessionBar}>
            <Select
              size="small"
              style={{ flex: 1 }}
              placeholder="Новый чат"
              value={sessionId ?? undefined}
              onChange={(v) => { setNewChat(false); setActiveSession(estimateId, v); }}
              options={sessions.map((s) => ({ value: s.id, label: s.title ?? 'Без названия' }))}
            />
            <Tooltip title="Новый чат">
              <Button size="small" icon={<PlusOutlined />} onClick={() => { setNewChat(true); setActiveSession(estimateId, null); }} />
            </Tooltip>
            {sessionId && (
              <Popconfirm title="Удалить чат?" onConfirm={() => deleteMut.mutate(sessionId)} okText="Удалить" cancelText="Отмена">
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            )}
          </div>

          <div style={scopeBar}>
            <WorkScopeSelect compact />
          </div>

          <AiMessageList
            messages={messages}
            applying={applyMut.isPending || applySectionMut.isPending}
            onApplyItems={(items) => applyMut.mutate(items)}
            onApplySection={(sourceEstimateId, costTypeId) => applySectionMut.mutate({ sourceEstimateId, costTypeId })}
            onExampleClick={(text) => setInput(text)}
          />
          <AiComposer
            input={input}
            loading={sendMut.isPending}
            busy={busy}
            onInputChange={setInput}
            onRun={handleRun}
            onStop={handleStop}
          />
        </>
      )}
    </div>
  );
}

const panelBox: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
  background: '#fff',
  border: '1px solid #f0f0f0',
  borderRadius: 8,
};

const header: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  padding: '9px 13px',
  borderBottom: '1px solid #f0f0f0',
  background: '#fafbfc',
  fontWeight: 600,
  fontSize: 13.5,
};

const sessionBar: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 10px',
  borderBottom: '1px solid #f5f5f5',
};

const scopeBar: React.CSSProperties = {
  flexShrink: 0,
  padding: '8px 10px',
  borderBottom: '1px solid #f5f5f5',
};
