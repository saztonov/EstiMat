import { Modal } from 'antd';
import { RequestDetailContent } from './RequestDetailContent';

/**
 * Модалка карточки заявки: единая обёртка над RequestDetailContent для всех вкладок
 * страницы «Заявки» (список, закупки, реестр РП, свод материалов). Открывается по клику,
 * заменяет переход на отдельную страницу /requests/:id.
 */
export function RequestDetailModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Modal
      open={!!id}
      onCancel={onClose}
      footer={null}
      width="80vw"
      style={{ top: 20 }}
      styles={{ body: { height: 'calc(90vh - 56px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 12 } }}
      destroyOnClose
    >
      {id && <RequestDetailContent id={id} onBack={onClose} />}
    </Modal>
  );
}
