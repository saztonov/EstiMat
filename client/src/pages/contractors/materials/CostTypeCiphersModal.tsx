import { Empty, Modal, Space, Typography } from 'antd';
import { modalWidth } from '../../../lib/modalWidth';
import { CipherTags } from '../../../components/CipherTags';

/** Вид работ, шифры которого показываем. costTypeId нужен для выборки, имя — для шапки. */
export interface CipherTarget {
  costTypeId: string | null;
  costTypeName: string | null;
}

/** Открыть шифры вида работ. Пробрасывается в дерево, колонки и карточки ИИ-блоков. */
export type OnCostTypeCiphers = (target: CipherTarget) => void;

interface Props {
  target: CipherTarget;
  /** Индекс шифров сметы: costTypeId → назначенные шифры (из детализации сметы). */
  costTypeCiphers: Record<string, { id: string; code: string }[]>;
  onClose: () => void;
}

/**
 * Шифры рабочей документации вида работ. Во вкладке «Материалы» строки сгруппированы по видам
 * работ, а места под теги в заголовках нет — показываем по клику и полным списком (в модалке
 * свёртка «+N» не нужна).
 */
export function CostTypeCiphersModal({ target, costTypeCiphers, onClose }: Props) {
  const ciphers = target.costTypeId ? costTypeCiphers[target.costTypeId] ?? [] : [];

  return (
    <Modal
      open
      title={
        <Space direction="vertical" size={0}>
          <span>Шифры рабочей документации</span>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
            {target.costTypeName ?? 'Без вида работ'}
          </Typography.Text>
        </Space>
      }
      width={modalWidth(520)}
      footer={null}
      onCancel={onClose}
    >
      {ciphers.length > 0 ? (
        <CipherTags codes={ciphers.map((c) => c.code)} all />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Шифры не назначены" />
      )}
    </Modal>
  );
}
