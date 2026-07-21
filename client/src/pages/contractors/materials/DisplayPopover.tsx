// Отборы показа списка материалов. Оба скрывают блоки целиком, а не строки внутри них: строка без
// остатка рядом с заявленными — это контекст группы, а не мусор.
import { Badge, Button, Divider, Popover, Space, Switch, Tooltip, Typography } from 'antd';
import { EyeOutlined } from '@ant-design/icons';

interface Props {
  /** Только блоки, где остался незаявленный объём. */
  onlyUnordered: boolean;
  onOnlyUnorderedChange: (v: boolean) => void;
  /** Только группы с замечаниями. Умный режим: в стандартном дереве групп ИИ нет. */
  onlyReview: boolean;
  onOnlyReviewChange: (v: boolean) => void;
  /** Сколько групп с замечаниями сейчас на экране; 0 — переключатель бесполезен. */
  reviewCount: number;
  showReview: boolean;
  disabled?: boolean;
}

export function DisplayPopover({
  onlyUnordered,
  onOnlyUnorderedChange,
  onlyReview,
  onOnlyReviewChange,
  reviewCount,
  showReview,
  disabled = false,
}: Props) {
  const showReviewSwitch = showReview && reviewCount > 0;
  const activeCount = (onlyUnordered ? 1 : 0) + (showReviewSwitch && onlyReview ? 1 : 0);

  const content = (
    <Space direction="vertical" size="middle" style={{ width: 280 }}>
      <Space size={8} align="start">
        <Switch size="small" checked={onlyUnordered} onChange={onOnlyUnorderedChange} />
        <div>
          <div style={{ fontSize: 13, color: 'var(--est-text-secondary)' }}>Не заказанные материалы</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Скрыть блоки, где всё уже заявлено
          </Typography.Text>
        </div>
      </Space>
      {showReviewSwitch && (
        <Space size={8} align="start">
          <Switch size="small" checked={onlyReview} onChange={onOnlyReviewChange} />
          <div>
            <div style={{ fontSize: 13, color: 'var(--est-text-secondary)' }}>Только с замечаниями ({reviewCount})</div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Неполные комплекты и возможные несовместимости
            </Typography.Text>
          </div>
        </Space>
      )}
      <Divider style={{ margin: 0 }} />
      <Button
        size="small"
        disabled={activeCount === 0}
        onClick={() => {
          onOnlyUnorderedChange(false);
          onOnlyReviewChange(false);
        }}
      >
        Сбросить
      </Button>
    </Space>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      title="Отображение"
      content={content}
      {...(disabled ? { open: false } : {})}
    >
      <Badge count={activeCount} size="small">
        {/* Tooltip внутри Popover, а не снаружи: иначе конфликтуют триггеры click и hover. */}
        <Tooltip title="Что показывать в списке материалов">
          <Button icon={<EyeOutlined />} disabled={disabled}>
            Отображение
          </Button>
        </Tooltip>
      </Badge>
    </Popover>
  );
}
