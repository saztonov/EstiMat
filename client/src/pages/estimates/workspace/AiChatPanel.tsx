import { useState } from 'react';
import { App, Button, Dropdown, Popconfirm, Segmented, Tooltip } from 'antd';
import { RobotOutlined, DoubleRightOutlined, DownOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
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
import { getEffectiveAddContext } from '../../../store/locationContextStore';
import { parseFloors } from '../components/location';
import { usePersistedTab } from '../../../hooks/usePersistedTab';

type AiMode = 'chat' | 'extract';

interface Props {
  estimateId: string;
  /** Инвалидация кэшей сметы после применения ИИ-позиций (учитывает маршрут загрузки). */
  onEstimateChanged: () => void;
  onCollapse: () => void;
}

export function AiChatPanel({ estimateId, onEstimateChanged, onCollapse }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  // Активная вкладка ИИ-панели переживает ремоунт (Splitter пересоздаёт панель при скрытии
  // справочников/сворачивании) — usePersistedTab читает значение из localStorage при маунте.
  const [aiModeRaw, setAiMode] = usePersistedTab('estimat:ai-tab', 'extract');
  const aiMode = aiModeRaw as AiMode;
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
  // Полное название активного чата — для всплывающей подсказки над селектором (в нём текст обрезается до 2 строк).
  const activeChatTitle = sessions.find((s) => s.id === sessionId)?.title ?? undefined;

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
    mutationFn: (items: ApplyItem[]) => {
      // Домешиваем текущий контекст добавления местоположения к работам (материалы наследуют от targetItemId).
      // Точный набор этажей с разрывами → locations: [{zoneId, floors}].
      const ctx = getEffectiveAddContext(estimateId);
      const floors = parseFloors(ctx.floorsText);
      const locations = ctx.zoneId || floors.length ? [{ zoneId: ctx.zoneId, floors }] : undefined;
      const withLoc = items.map((it) =>
        it.kind === 'work' && locations ? { ...it, locations } : it,
      );
      return applySelectedApi({ chatId: sessionId as string, items: withLoc, override: false });
    },
    onSuccess: (res) => {
      const { works, materials } = res.data.added;
      message.success(`Добавлено: работ ${works}, материалов ${materials}`);
      if (res.data.skipped.length) message.info(`Пропущено дублей: ${res.data.skipped.length}`);
      onEstimateChanged();
      if (res.data.addedItemIds[0]) revealEstimateItem(res.data.addedItemIds[0]);
    },
    onError: (e: Error) => message.error(e.message),
  });

  const applySectionMut = useMutation({
    mutationFn: (p: { sourceEstimateId: string; costTypeId: string }) =>
      applySectionApi({ chatId: sessionId as string, sourceEstimateId: p.sourceEstimateId, costTypeId: p.costTypeId, override: false }),
    onSuccess: (res) => {
      message.success(`Скопировано работ: ${res.data.added.works}`);
      onEstimateChanged();
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
        <RobotOutlined style={{ color: 'var(--est-text-tertiary)' }} />
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
          <AiExtractPanel estimateId={estimateId} onEstimateChanged={onEstimateChanged} />
        </div>
      ) : (
        <>
          <div style={sessionBar}>
            <Dropdown
              trigger={['click']}
              overlayClassName="estimat-chat-menu"
              menu={{
                items: sessions.length
                  ? sessions.map((s) => ({ key: s.id, label: s.title ?? 'Без названия' }))
                  : [{ key: '__none', label: 'Чатов пока нет', disabled: true }],
                selectedKeys: sessionId ? [sessionId] : [],
                onClick: ({ key }) => { setNewChat(false); setActiveSession(estimateId, key); },
              }}
            >
              <button type="button" title={activeChatTitle} style={chatTriggerBox}>
                <span style={chatTriggerText}>{activeChatTitle ?? 'Новый чат'}</span>
                <DownOutlined style={{ fontSize: 11, color: 'var(--est-text-tertiary)', flexShrink: 0, marginTop: 2 }} />
              </button>
            </Dropdown>
            <Tooltip title="Новый чат">
              <Button size="small" style={{ flexShrink: 0 }} icon={<PlusOutlined />} onClick={() => { setNewChat(true); setActiveSession(estimateId, null); }} />
            </Tooltip>
            {sessionId && (
              <Popconfirm title="Удалить чат?" onConfirm={() => deleteMut.mutate(sessionId)} okText="Удалить" cancelText="Отмена">
                <Button size="small" danger style={{ flexShrink: 0 }} icon={<DeleteOutlined />} />
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
  background: 'var(--est-bg-container)',
  border: '1px solid var(--est-border)',
  borderRadius: 8,
};

const header: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  padding: '9px 13px',
  borderBottom: '1px solid var(--est-border)',
  background: 'var(--est-bg-subtle)',
  fontWeight: 600,
  fontSize: 13.5,
};

const sessionBar: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 6,
  padding: '8px 8px',
  borderBottom: '1px solid var(--est-border)',
};

// Триггер выбора чата вместо нативного Select: своё название с переносом в 2 строки.
const chatTriggerBox: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 4,
  background: 'var(--est-bg-container)',
  border: '1px solid var(--est-border-strong)',
  borderRadius: 6,
  padding: '2px 8px',
  cursor: 'pointer',
  textAlign: 'left',
  fontSize: 12,
  lineHeight: 1.3,
  color: 'var(--est-text)',
  fontFamily: 'inherit',
};

const chatTriggerText: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  maxHeight: '2.6em', // страховка: 2 строки даже если line-clamp недоступен
  paddingBlock: 2,
};

const scopeBar: React.CSSProperties = {
  flexShrink: 0,
  padding: '8px 10px',
  borderBottom: '1px solid var(--est-border)',
};
