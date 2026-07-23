import { useState } from 'react';
import { Button, Divider, Popover, Space, Spin, Tag, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { CipherTags } from '../../components/CipherTags';
import { formatContractLabel } from '../contractors/vor/contractLabel';
import type { RequestVorContext } from './types';

interface Props {
  requestId: string;
  contractorName: string | null;
  /** Шифры РД всей заявки (объединение по видам работ её позиций) — приходят со строкой списка. */
  ciphers: string[];
}

// Строка «подпись — значение»: подписи узкой колонкой слева, значения переносятся.
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
      <span style={{ flex: '0 0 96px', fontSize: 12, color: 'var(--est-text-tertiary)' }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{children}</span>
    </div>
  );
}

const dash = <span style={{ color: 'var(--est-text-tertiary)' }}>—</span>;

// Список значений тегами. Цвет — признак строки, а не значения: рядом стоящие «Местоположение» и
// «Тип» иначе сливаются в одно пятно (то же правило, что в реестре «ВОР объекта»).
function Tags({ values, color }: { values: string[]; color: string }) {
  if (values.length === 0) return dash;
  return (
    <Space size={4} wrap>
      {values.map((v) => (
        <Tag key={v} color={color} style={{ margin: 0, whiteSpace: 'normal' }}>
          {v}
        </Tag>
      ))}
    </Space>
  );
}

// Содержимое монтируется ТОЛЬКО при открытом поповере: иначе на каждую строку списка заводился бы
// наблюдатель react-query, хотя открыт всегда максимум один (тот же приём, что в RowInfoPopover).
function RequestInfoContent({ requestId, contractorName, ciphers }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['requests', 'vor-context', requestId],
    queryFn: () => api.get<{ data: RequestVorContext }>(`/requests/${requestId}/vor-context`),
  });
  const ctx = data?.data;

  return (
    <div style={{ minWidth: 280, maxWidth: 380 }}>
      <Row label="Подрядчик">{contractorName || dash}</Row>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <Spin size="small" />
        </div>
      ) : !ctx || ctx.vors.length === 0 ? (
        <Row label="Договор">
          <Typography.Text type="secondary">Договор не найден</Typography.Text>
        </Row>
      ) : (
        ctx.vors.map((v) => (
          <div key={v.vorId}>
            <Divider style={{ margin: '8px 0' }} />
            {/* Реквизитов нет вовсе (подрядчика назначили до реестра договоров) — честный прочерк,
                а не «Без номера»: последнее означало бы, что связка есть, а номер не заполнили. */}
            <Row label="Договор">
              {v.contractNumber || v.contractDate
                ? formatContractLabel({ number: v.contractNumber, date: v.contractDate })
                : dash}
            </Row>
            <Row label="ВОР">{v.vorName}</Row>
            <Row label="Местоположение">
              <Tags values={v.facets.locations} color="blue" />
            </Row>
            <Row label="Тип">
              <Tags values={v.facets.types} color="green" />
            </Row>
          </div>
        ))
      )}

      {/* Шифры — по всей заявке, а не по конкретному ВОР: внутри блока ВОР они читались бы как его. */}
      <Divider style={{ margin: '8px 0' }} />
      <Row label="Шифры РД">{ciphers.length > 0 ? <CipherTags codes={ciphers} all /> : dash}</Row>

      {ctx && ctx.matched === 'estimate' && ctx.vors.length > 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          Строки заявки не связаны с ВОР — показаны договоры подрядчика по объекту
        </Typography.Text>
      )}
      {ctx && ctx.matched === 'items' && ctx.hasUnlinkedItems && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          Часть позиций не связана со строками сметы
        </Typography.Text>
      )}
    </div>
  );
}

/**
 * Договорный контекст заявки: подрядчик, номер и дата договора, ВОР с местоположениями и типами,
 * шифры РД. Данные тянутся лениво при открытии (GET /requests/:id/vor-context) — в списке заявок
 * их нет, а тот же список отдаёт общий реестр до 5000 строк.
 */
export function RequestInfoPopover(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      trigger="click"
      title="Информация о заявке"
      content={open ? <RequestInfoContent {...props} /> : null}
      open={open}
      onOpenChange={setOpen}
    >
      <Button type="text" size="small" icon={<InfoCircleOutlined />} title="Информация о заявке" />
    </Popover>
  );
}
