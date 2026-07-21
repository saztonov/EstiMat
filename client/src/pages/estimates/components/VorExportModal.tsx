import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Input, Tag, Alert } from 'antd';
import type { VorFilterSnapshot } from '@estimat/shared';

interface Props {
  open: boolean;
  onClose: () => void;
  // Имя по умолчанию (ВОР_<код объекта>_<дата>) — подставляется при открытии.
  defaultName: string;
  // Число строк, попавших в выгрузку (по текущему отбору, заморожено при открытии).
  itemCount: number;
  exporting: boolean;
  // Снимок применённых фильтров (id + подписи) — только для показа.
  snapshot: VorFilterSnapshot;
  onSubmit: (name: string) => void;
}

const VOLUME_LABEL: Record<VorFilterSnapshot['volumeType'], string> = {
  all: '',
  main: 'Основной',
  additional: 'Дополнительный',
};

// Строка сводки «метка: значение» (значение — теги или текст). Пустые не рендерим.
function FilterRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
      <span style={{ minWidth: 96, color: 'var(--est-text-tertiary)', fontSize: 12 }}>{label}</span>
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  );
}

// Модалка «Экспорт в ВОР»: имя файла + сводка применённых фильтров. Экспорт всегда создаёт запись
// ВОР (файл-снимок сохраняется в списке «Созданные ВОР»). Вход заморожен в SmetaPanel — модалка
// только показывает и передаёт введённое имя.
export function VorExportModal({ open, onClose, defaultName, itemCount, exporting, snapshot, onSubmit }: Props) {
  const [name, setName] = useState(defaultName);
  // При каждом открытии подставляем свежее имя по умолчанию.
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  const tags = (items: { id: string; name: string }[]) =>
    items.map((it) => (
      <Tag key={it.id} style={{ marginBottom: 2 }}>
        {it.name}
      </Tag>
    ));

  const location: ReactNode[] = [];
  if (snapshot.zones.length) location.push(snapshot.zones.map((z) => z.name).join(', '));
  if (snapshot.floorsText.trim()) location.push(`эт. ${snapshot.floorsText.trim()}`);

  const hasFilters =
    snapshot.categories.length ||
    snapshot.types.length ||
    snapshot.zones.length ||
    snapshot.floorsText.trim() ||
    snapshot.locationTypes.length ||
    snapshot.volumeType !== 'all' ||
    snapshot.onlyUnreconciled;

  const canSubmit = itemCount > 0 && name.trim().length > 0;

  return (
    <Modal
      title="Экспорт в ВОР"
      open={open}
      onCancel={onClose}
      onOk={() => onSubmit(name.trim())}
      okText="Экспортировать"
      cancelText="Отмена"
      okButtonProps={{ disabled: !canSubmit, loading: exporting }}
      destroyOnClose
      width={560}
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 4, fontWeight: 500 }}>Название файла</div>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={() => canSubmit && onSubmit(name.trim())}
          placeholder="Название ВОР"
          maxLength={150}
          autoFocus
        />
        <div style={{ marginTop: 4, color: 'var(--est-text-tertiary)', fontSize: 12 }}>
          Расширение «.xlsx» добавится автоматически.
        </div>
      </div>

      {itemCount === 0 ? (
        <Alert type="warning" showIcon message="Нет строк для экспорта — измените фильтры." />
      ) : (
        <div>
          <div style={{ marginBottom: 6, fontWeight: 500 }}>
            Применённые фильтры <span style={{ color: 'var(--est-text-tertiary)', fontWeight: 400 }}>· работ: {itemCount}</span>
          </div>
          {hasFilters ? (
            <div style={{ background: 'var(--est-bg-subtle)', border: '1px solid var(--est-border)', borderRadius: 8, padding: '8px 12px' }}>
              {snapshot.categories.length > 0 && <FilterRow label="Категория">{tags(snapshot.categories)}</FilterRow>}
              {snapshot.types.length > 0 && <FilterRow label="Вид работ">{tags(snapshot.types)}</FilterRow>}
              {location.length > 0 && <FilterRow label="Локация">{location.join(' · ')}</FilterRow>}
              {snapshot.locationTypes.length > 0 && <FilterRow label="Тип">{tags(snapshot.locationTypes)}</FilterRow>}
              {snapshot.volumeType !== 'all' && <FilterRow label="Объём">{VOLUME_LABEL[snapshot.volumeType]}</FilterRow>}
              {snapshot.onlyUnreconciled && <FilterRow label="Отбор">Только несогласованные</FilterRow>}
            </div>
          ) : (
            <div style={{ color: 'var(--est-text-tertiary)', fontSize: 12 }}>Фильтры не применены — выгружается вся смета.</div>
          )}
        </div>
      )}
    </Modal>
  );
}
