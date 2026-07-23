import type { ModalStaticFunctions } from 'antd/es/modal/confirm';
import type { AssignBlockedItem } from '@estimat/shared';

/**
 * Отчёт «сработало не на всех строках»: по каким работам исполнитель не сменился и почему.
 * Общий для назначения и снятия подрядчика — запрет в обоих случаях один и тот же (оформленная
 * заявка на материалы), расходиться двум объяснениям незачем; различается только заголовок.
 */
export function showBlockedReport(
  modal: Pick<ModalStaticFunctions, 'info'>,
  blocked: AssignBlockedItem[],
  nameById: Map<string, string>,
  variant: 'assign' | 'unassign' = 'assign',
): void {
  if (blocked.length === 0) return;
  const shown = blocked.slice(0, 20);
  modal.info({
    title: variant === 'unassign' ? 'Снято не со всех строк' : 'Назначено не на все строки',
    width: 520,
    content: (
      <div>
        <p style={{ marginTop: 0 }}>
          {variant === 'unassign'
            ? 'По этим строкам подрядчик уже оформил заявку на материалы — они остались за ним.'
            : 'По этим строкам подрядчик уже оформил заявку на материалы — исполнитель у них не менялся.'}
        </p>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          {shown.map((b) => (
            <li key={b.itemId}>
              {nameById.get(b.itemId) ?? 'Строка сметы'}
              {b.contractors.length > 0 && (
                <span style={{ color: 'var(--est-text-tertiary)' }}>
                  {' '}
                  — {b.contractors.map((c) => c.contractorName ?? '—').join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
        {blocked.length > shown.length && (
          <p style={{ marginBottom: 0, color: 'var(--est-text-tertiary)' }}>
            …и ещё {blocked.length - shown.length}
          </p>
        )}
      </div>
    ),
  });
}
