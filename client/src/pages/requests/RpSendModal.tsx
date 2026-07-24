import { useState, useEffect } from 'react';
import { Modal, Form, Input, DatePicker, Alert, Tag, Typography, Image, Button, Space, Spin, App } from 'antd';
import { DownloadOutlined, LinkOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import { safeExternalHref } from '../../lib/safeUrl';
import { svgDataUrlToPngDataUrl, downloadDataUrl } from '../../lib/qr';
import type { RpConfig } from './types';

const { Text } = Typography;

interface SentResult {
  regNumber: string | null;
  url: string | null;
  qr: string | null;
}

/**
 * Модалка «Отправить РП» (вид billhub): read-only реквизиты письма PayHub + редактируемые поля,
 * QR после отправки. Письмо создаётся синхронно одним шагом; файлы уже приложены к заявке и уходят
 * в PayHub автоматически, поэтому Upload здесь нет.
 */
export function RpSendModal({
  open,
  requestId,
  expectedVersion,
  onClose,
  onDone,
}: {
  open: boolean;
  requestId: string;
  expectedVersion: number | undefined;
  onClose: () => void;
  /** Успешная отправка — обновить карточку/реестр. */
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [cfg, setCfg] = useState<RpConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<SentResult | null>(null);
  const [qrPng, setQrPng] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSent(null);
    setQrPng(null);
    setCfg(null);
    setLoading(true);
    form.resetFields();
    api
      .get<{ data: RpConfig }>(`/requests/${requestId}/rp-config`)
      .then((r) => {
        const c = r.data;
        setCfg(c);
        form.setFieldsValue({
          letterDate: dayjs(),
          invoiceNumber: '',
          subject: c.defaultSubject || 'РП',
          content: c.defaultContent || '',
          responsibleName: c.responsibleName ?? '',
        });
      })
      .catch((e) => message.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, requestId, form, message]);

  async function submit() {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      const r = await api.post<{ data: SentResult & { id: string; status: string } }>(
        `/requests/${requestId}/rp-send`,
        {
          rpDate: v.letterDate.format('YYYY-MM-DD'),
          subject: v.subject || null,
          content: v.content || null,
          invoiceNumber: v.invoiceNumber || null,
          responsibleName: v.responsibleName || null,
          expectedVersion,
        },
      );
      const res: SentResult = { regNumber: r.data.regNumber, url: r.data.url, qr: r.data.qr };
      setSent(res);
      if (res.qr) {
        try {
          setQrPng(await svgDataUrlToPngDataUrl(res.qr));
        } catch {
          setQrPng(null);
        }
      }
      message.success(`РП отправлено${res.regNumber ? `: ${res.regNumber}` : ''}, письмо создано в PayHub`);
      onDone();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function downloadQr() {
    const base = sent?.regNumber ? `QR_${sent.regNumber}` : 'QR_РП';
    if (qrPng) downloadDataUrl(qrPng, `${base}.png`);
    else if (sent?.qr) downloadDataUrl(sent.qr, `${base}.svg`);
  }

  const senderLabel = cfg?.sender
    ? `${cfg.sender.name ?? '—'}${cfg.sender.inn ? ` (ИНН ${cfg.sender.inn})` : ''}`
    : null;
  const recipientLabel = cfg?.recipient
    ? `${cfg.recipient.name ?? '—'}${cfg.recipient.inn ? ` (ИНН ${cfg.recipient.inn})` : ''}`
    : null;
  const projectLabel = cfg?.project ? [cfg.project.code, cfg.project.name].filter(Boolean).join(' · ') : null;

  return (
    <Modal
      title="Отправить РП"
      open={open}
      onCancel={onClose}
      width={modalWidth(640)}
      maskClosable={false}
      footer={
        sent
          ? [
              <Button key="done" type="primary" onClick={onClose}>
                Готово
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={onClose}>
                Отмена
              </Button>,
              <Button key="send" type="primary" loading={submitting} onClick={submit}>
                Отправить в PayHub
              </Button>,
            ]
      }
    >
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : (
        <>
          {!sent && cfg && !cfg.mapped && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Объект не сопоставлен с PayHub"
              description="Проект или получатель PayHub не заданы (Администрирование → PayHub). Отправить письмо нельзя."
            />
          )}
          {!sent && cfg && !cfg.sender && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Отправитель РП не настроен (Администрирование → PayHub)."
            />
          )}
          {sent && (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message={`Письмо создано${sent.regNumber ? `: ${sent.regNumber}` : ''}`}
              description="Скачайте QR при необходимости и вставьте его в документ письма."
            />
          )}

          <Form form={form} layout="vertical" disabled={submitting || !!sent}>
            <Form.Item label="Направление">
              <Tag color="blue">Исходящее</Tag>
            </Form.Item>
            <Form.Item label="Проект">
              <Text>{projectLabel ?? <Text type="secondary">не сопоставлен</Text>}</Text>
            </Form.Item>
            <Form.Item label="Номер письма">
              <Input disabled value={sent?.regNumber ?? undefined} placeholder="Присваивается автоматически генератором PayHub" />
            </Form.Item>
            <Form.Item name="invoiceNumber" label="Номер счёта">
              <Input maxLength={100} placeholder="Номер счёта" allowClear />
            </Form.Item>
            <Form.Item name="letterDate" label="Дата письма" rules={[{ required: true, message: 'Укажите дату' }]}>
              <DatePicker format="DD.MM.YYYY" style={{ width: 200 }} allowClear={false} />
            </Form.Item>
            <Form.Item label="Отправитель">
              <Text>{senderLabel ?? <Text type="secondary">не настроен</Text>}</Text>
            </Form.Item>
            <Form.Item label="Получатель">
              <Text>{recipientLabel ?? <Text type="secondary">не сопоставлен</Text>}</Text>
            </Form.Item>
            <Form.Item name="subject" label="Тема" rules={[{ required: true, whitespace: true, message: 'Укажите тему' }]}>
              <Input maxLength={500} />
            </Form.Item>
            <Form.Item name="content" label="Содержание">
              <Input.TextArea rows={3} maxLength={4000} showCount />
            </Form.Item>
            <Form.Item name="responsibleName" label="Ответственный">
              <Input maxLength={200} />
            </Form.Item>
          </Form>

          {sent && (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {(qrPng || sent.qr) && (
                <div>
                  <Text type="secondary">QR-код письма</Text>
                  <div style={{ marginTop: 4 }}>
                    <Image
                      src={qrPng ?? sent.qr ?? undefined}
                      width={160}
                      alt="QR-код письма PayHub"
                      style={{ border: '1px solid var(--est-border)', background: 'var(--est-bg-container)' }}
                    />
                  </div>
                  <Button icon={<DownloadOutlined />} style={{ marginTop: 8 }} onClick={downloadQr}>
                    Скачать {qrPng ? 'PNG' : 'SVG'}
                  </Button>
                </div>
              )}
              {sent.url && (
                <a href={safeExternalHref(sent.url)} target="_blank" rel="noopener noreferrer">
                  Открыть письмо <LinkOutlined />
                </a>
              )}
            </Space>
          )}
        </>
      )}
    </Modal>
  );
}
