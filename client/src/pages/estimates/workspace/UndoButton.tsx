import { App, Button, Tooltip } from 'antd';
import { UndoOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getUndoPeek, postUndo } from '../../../services/estimateUndo';
import { ApiError } from '../../../services/api';
import { invalidateEstimateQueries } from '../../../lib/estimateQueries';
import { useAuthStore } from '../../../store/authStore';

interface Props {
  estimateId: string;
  projectId: string;
  editable: boolean;
  /** Телефонный режим: кнопка без текста, только иконка. */
  compact?: boolean;
}

// Кнопка «Отменить» — откат последнего действия пользователя в смете (add/edit/delete строк,
// в т.ч. массовое удаление). Держит своё peek-состояние и мутацию, чтобы не тянуть пропсы
// через дерево панелей. Отмена — серверная (на журнале), поэтому после успеха просто
// инвалидируем смету и историю — данные перечитаются.
export function UndoButton({ estimateId, projectId, editable, compact }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canUndo = editable && (role === 'admin' || role === 'engineer' || role === 'manager');

  const { data: peek } = useQuery({
    queryKey: ['estimate-undo-peek', estimateId],
    queryFn: () => getUndoPeek(estimateId),
    enabled: canUndo,
  });
  const target = peek?.data.undo ?? null;
  const available = !!target?.available;

  const refresh = () => {
    invalidateEstimateQueries(queryClient, { estimateId, projectId });
    queryClient.invalidateQueries({ queryKey: ['estimate-history', estimateId] });
  };

  const undo = useMutation({
    mutationFn: () => postUndo(estimateId),
    onSuccess: (res) => {
      refresh();
      message.success(`Отменено: ${res.data.summary}`);
    },
    onError: (err) => {
      // 409 (UNDO_CONFLICT/UNDO_EMPTY) — не ошибка приложения: показываем предупреждение и
      // обновляем данные/состояние кнопки. Прочие — обычная ошибка.
      if (err instanceof ApiError && err.status === 409) {
        message.warning(err.message);
        refresh();
      } else {
        message.error(err instanceof Error ? err.message : 'Не удалось отменить действие');
      }
    },
  });

  if (!canUndo) return null;

  return (
    <Tooltip title={available ? `Отменить: ${target?.summary}` : 'Нет действий для отмены'}>
      <Button
        size="small"
        icon={<UndoOutlined />}
        aria-label="Отменить"
        disabled={!available || undo.isPending}
        loading={undo.isPending}
        onClick={() => undo.mutate()}
      >
        {compact ? null : 'Отменить'}
      </Button>
    </Tooltip>
  );
}
