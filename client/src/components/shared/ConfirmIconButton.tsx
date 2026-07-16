import { useState } from 'react';
import { Button, Popconfirm, Tooltip } from 'antd';
import type { ButtonProps } from 'antd';
import type { ReactNode } from 'react';

interface ConfirmIconButtonProps {
  /** Текст подсказки при наведении (и aria-label кнопки-иконки). */
  tooltip: string;
  title: ReactNode;
  description?: ReactNode;
  okText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  icon?: ReactNode;
  type?: ButtonProps['type'];
  size?: ButtonProps['size'];
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
}

/**
 * Кнопка-иконка с подтверждением для строк таблиц.
 *   - onPopupClick гасит клики по «Удалить»/«Отмена»: попап Popconfirm живёт в портале, но
 *     React-события всплывают по React-дереву — без этого клик доходит до onRow строки и
 *     открывает карточку уже удалённой записи.
 *   - Подсказка контролируемая: пока открыто подтверждение, она не показывается, иначе висит
 *     поверх кнопки «Удалить» и мешает по ней попасть.
 */
export function ConfirmIconButton({
  tooltip, title, description,
  okText = 'Удалить', cancelText = 'Отмена', onConfirm,
  icon, type, size = 'small', danger, loading, disabled,
}: ConfirmIconButtonProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Popconfirm
      title={title}
      description={description}
      okText={okText}
      cancelText={cancelText}
      okButtonProps={{ danger: true }}
      onConfirm={onConfirm}
      open={confirmOpen}
      onOpenChange={(open) => {
        setConfirmOpen(open);
        if (open) setTooltipOpen(false);
      }}
      onPopupClick={(e) => e.stopPropagation()}
    >
      <Tooltip
        title={tooltip}
        open={confirmOpen ? false : tooltipOpen}
        onOpenChange={setTooltipOpen}
      >
        <Button
          type={type}
          size={size}
          danger={danger}
          icon={icon}
          loading={loading}
          disabled={disabled}
          aria-label={tooltip}
          onClick={(e) => e.stopPropagation()}
        />
      </Tooltip>
    </Popconfirm>
  );
}
