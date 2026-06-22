import { useState } from 'react';
import { Button, Checkbox, InputNumber, Tag, Tooltip, Typography } from 'antd';
import { PlusOutlined, CopyOutlined } from '@ant-design/icons';
import type { ApplyItem, ChatCard, WorkCandidate, MaterialCandidate, SimilarWork, SimilarMaterial } from '@estimat/shared';
import { useEstimateSelectionStore } from '../../../store/estimateSelectionStore';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);

interface Props {
  card: ChatCard;
  applying: boolean;
  onApplyItems: (items: ApplyItem[]) => void;
  onApplySection: (sourceEstimateId: string, costTypeId: string) => void;
}

const cardBox: React.CSSProperties = {
  marginTop: 8,
  border: '1px solid #e6effa',
  background: '#f7fbff',
  borderRadius: 8,
  padding: 10,
};

const rowBox: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
  borderTop: '1px solid #eef3f8',
};

export function AiCandidateCards({ card, applying, onApplyItems, onApplySection }: Props) {
  switch (card.type) {
    case 'work_candidates':
      return <WorkCandidatesCard items={card.items} title={card.title ?? null} applying={applying} onApply={onApplyItems} />;
    case 'material_candidates':
      return <MaterialCandidatesCard items={card.items} title={card.title ?? null} targetItemId={card.targetItemId ?? null} applying={applying} onApply={onApplyItems} />;
    case 'similar_works':
      return <SimilarWorksCard items={card.items} applying={applying} onApply={onApplyItems} />;
    case 'similar_materials':
      return <SimilarMaterialsCard items={card.items} applying={applying} onApply={onApplyItems} />;
    case 'section_preview':
      return (
        <div style={cardBox}>
          <Typography.Text strong style={{ fontSize: 12.5 }}>
            Раздел для копирования — {card.works.length} работ
          </Typography.Text>
          {card.works.slice(0, 8).map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>
              • {w.description} — {fmt(w.quantity)} {w.unit ?? ''}
            </div>
          ))}
          <Button
            size="small"
            type="primary"
            icon={<CopyOutlined />}
            loading={applying}
            style={{ marginTop: 8 }}
            onClick={() => onApplySection(card.sourceEstimateId, card.costTypeId)}
          >
            Скопировать раздел
          </Button>
        </div>
      );
    case 'calc':
      return (
        <div style={cardBox}>
          <Typography.Text strong>🧮 {fmt(card.value)} {card.unit}</Typography.Text>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{card.formula}</div>
        </div>
      );
    default:
      return null;
  }
}

// ---- Работы из справочника ----
function WorkCandidatesCard({
  items,
  title,
  applying,
  onApply,
}: {
  items: WorkCandidate[];
  title: string | null;
  applying: boolean;
  onApply: (items: ApplyItem[]) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [typical, setTypical] = useState(true);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const apply = () => {
    const out: ApplyItem[] = items
      .filter((c) => sel.has(c.catalogId))
      .map((c) => ({
        kind: 'work',
        source: c.source,
        catalogId: c.catalogId,
        quantity: qty[c.catalogId] ?? 1,
        addTypicalMaterials: typical,
      }));
    if (out.length) onApply(out);
  };

  return (
    <div style={cardBox}>
      <Typography.Text
        strong
        style={{ fontSize: 12.5, display: 'block' }}
        ellipsis={title ? { tooltip: `Работы из справочника: «${title}»` } : false}
      >
        Работы из справочника{title ? `: «${title}»` : ''}
      </Typography.Text>
      {items.map((c) => (
        <div key={c.catalogId} style={rowBox}>
          <Checkbox checked={sel.has(c.catalogId)} onChange={() => toggle(c.catalogId)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5 }}>
              {c.name}{' '}
              {c.duplicateOfItemId && <Tag color="gold" style={{ marginInlineStart: 4 }}>уже в смете</Tag>}
              {c.typicalMaterialsCount > 0 && <Tag color="blue">мат. {c.typicalMaterialsCount}</Tag>}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>
              {[c.categoryName, c.costTypeName].filter(Boolean).join(' › ') || '—'} · {fmt(c.price)} ₽/{c.unit ?? '—'}
            </div>
          </div>
          <InputNumber size="small" min={0.0001} value={qty[c.catalogId] ?? 1} style={{ width: 78 }}
            onChange={(v) => setQty((q) => ({ ...q, [c.catalogId]: Number(v) || 1 }))} />
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <Checkbox checked={typical} onChange={(e) => setTypical(e.target.checked)} style={{ fontSize: 12 }}>
          типовые материалы
        </Checkbox>
        <span style={{ flex: 1 }} />
        <Button size="small" type="primary" icon={<PlusOutlined />} loading={applying} disabled={sel.size === 0} onClick={apply}>
          Добавить выбранные ({sel.size})
        </Button>
      </div>
    </div>
  );
}

// ---- Материалы из справочника (к выбранной в смете работе) ----
function MaterialCandidatesCard({
  items,
  title,
  targetItemId,
  applying,
  onApply,
}: {
  items: MaterialCandidate[];
  title: string | null;
  targetItemId: string | null;
  applying: boolean;
  onApply: (items: ApplyItem[]) => void;
}) {
  const selectedWorkId = useEstimateSelectionStore((s) => s.selectedWorkId);
  const target = targetItemId ?? selectedWorkId;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState<Record<string, number>>({});
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const apply = () => {
    if (!target) return;
    const out: ApplyItem[] = items
      .filter((c) => sel.has(c.catalogId))
      .map((c) => ({ kind: 'material', source: c.source, catalogId: c.catalogId, quantity: qty[c.catalogId] ?? 1, targetItemId: target }));
    if (out.length) onApply(out);
  };

  return (
    <div style={cardBox}>
      <Typography.Text
        strong
        style={{ fontSize: 12.5, display: 'block' }}
        ellipsis={title ? { tooltip: `Материалы из справочника: «${title}»` } : false}
      >
        Материалы из справочника{title ? `: «${title}»` : ''}
      </Typography.Text>
      {items.map((c) => (
        <div key={c.catalogId} style={rowBox}>
          <Checkbox checked={sel.has(c.catalogId)} onChange={() => toggle(c.catalogId)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5 }}>
              {c.name} {c.duplicateOfItemId && <Tag color="gold">уже в смете</Tag>}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{fmt(c.price)} ₽/{c.unit ?? '—'}</div>
          </div>
          <InputNumber size="small" min={0.0001} value={qty[c.catalogId] ?? 1} style={{ width: 78 }}
            onChange={(v) => setQty((q) => ({ ...q, [c.catalogId]: Number(v) || 1 }))} />
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <span style={{ flex: 1, fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
          {target ? 'материалы добавятся к выбранной работе' : 'выберите работу в смете'}
        </span>
        <Tooltip title={!target ? 'Сначала выберите работу в смете' : ''}>
          <Button size="small" type="primary" icon={<PlusOutlined />} loading={applying}
            disabled={sel.size === 0 || !target} onClick={apply}>
            Добавить ({sel.size})
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

// ---- Похожие работы из чужих смет ----
function SimilarWorksCard({
  items,
  applying,
  onApply,
}: {
  items: SimilarWork[];
  applying: boolean;
  onApply: (items: ApplyItem[]) => void;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [qty, setQty] = useState<Record<number, number>>({});
  const toggle = (i: number) => setSel((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const apply = () => {
    const out: ApplyItem[] = items
      .map((w, i) => ({ w, i }))
      .filter(({ w, i }) => sel.has(i) && w.rateId)
      .map(({ w, i }) => ({ kind: 'work', source: 'legacy', catalogId: w.rateId as string, quantity: qty[i] ?? w.quantity, addTypicalMaterials: false }));
    if (out.length) onApply(out);
  };

  return (
    <div style={cardBox}>
      <Typography.Text strong style={{ fontSize: 12.5 }}>Похожие работы в других объектах</Typography.Text>
      {items.map((w, i) => (
        <div key={i} style={rowBox}>
          <Tooltip title={w.rateId ? '' : 'Нет привязки к расценке — добавить нельзя'}>
            <Checkbox checked={sel.has(i)} disabled={!w.rateId} onChange={() => toggle(i)} />
          </Tooltip>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5 }}>{w.description}</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>
              {w.projectName ?? 'объект'} · {fmt(w.quantity)} {w.unit ?? ''} · {fmt(w.unitPrice)} ₽
            </div>
          </div>
          {w.rateId && (
            <InputNumber size="small" min={0.0001} value={qty[i] ?? w.quantity} style={{ width: 78 }}
              onChange={(v) => setQty((q) => ({ ...q, [i]: Number(v) || 1 }))} />
          )}
        </div>
      ))}
      <div style={{ display: 'flex', marginTop: 8 }}>
        <span style={{ flex: 1 }} />
        <Button size="small" type="primary" icon={<PlusOutlined />} loading={applying} disabled={sel.size === 0} onClick={apply}>
          Добавить в мою смету ({sel.size})
        </Button>
      </div>
    </div>
  );
}

// ---- Похожие материалы из чужих смет ----
function SimilarMaterialsCard({
  items,
  applying,
  onApply,
}: {
  items: SimilarMaterial[];
  applying: boolean;
  onApply: (items: ApplyItem[]) => void;
}) {
  const selectedWorkId = useEstimateSelectionStore((s) => s.selectedWorkId);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [qty, setQty] = useState<Record<number, number>>({});
  const toggle = (i: number) => setSel((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const apply = () => {
    if (!selectedWorkId) return;
    const out: ApplyItem[] = items
      .map((m, i) => ({ m, i }))
      .filter(({ m, i }) => sel.has(i) && m.materialId)
      .map(({ m, i }) => ({ kind: 'material', source: 'legacy', catalogId: m.materialId as string, quantity: qty[i] ?? m.quantity, targetItemId: selectedWorkId }));
    if (out.length) onApply(out);
  };

  return (
    <div style={cardBox}>
      <Typography.Text strong style={{ fontSize: 12.5 }}>Похожие материалы в других объектах</Typography.Text>
      {items.map((m, i) => (
        <div key={i} style={rowBox}>
          <Tooltip title={m.materialId ? '' : 'Нет привязки к справочнику'}>
            <Checkbox checked={sel.has(i)} disabled={!m.materialId} onChange={() => toggle(i)} />
          </Tooltip>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5 }}>{m.description}</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>
              {m.projectName ?? 'объект'}{m.parentWorkDescription ? ` · ${m.parentWorkDescription}` : ''} · {fmt(m.unitPrice)} ₽
            </div>
          </div>
          {m.materialId && (
            <InputNumber size="small" min={0.0001} value={qty[i] ?? m.quantity} style={{ width: 78 }}
              onChange={(v) => setQty((q) => ({ ...q, [i]: Number(v) || 1 }))} />
          )}
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <span style={{ flex: 1, fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
          {selectedWorkId ? 'добавятся к выбранной работе' : 'выберите работу в смете'}
        </span>
        <Button size="small" type="primary" icon={<PlusOutlined />} loading={applying}
          disabled={sel.size === 0 || !selectedWorkId} onClick={apply}>
          Добавить ({sel.size})
        </Button>
      </div>
    </div>
  );
}
