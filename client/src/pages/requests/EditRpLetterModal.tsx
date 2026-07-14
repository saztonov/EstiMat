import { useEffect, useState } from 'react';
import { Modal, Form, Input, DatePicker, App } from 'antd';
import dayjs from 'dayjs';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import type { RequestRow } from './types';

/** Правка текста письма РП из реестра (тема/содержание/ответственный/дата). PayHub-first на бэке. */
export function EditRpLetterModal({
  open,
  letter,
  onClose,
  onSaved,
}: {
  open: boolean;
  letter: RequestRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !letter) return;
    form.setFieldsValue({
      letterDate: letter.rp_letter_date ? dayjs(letter.rp_letter_date) : dayjs(),
      subject: letter.rp_subject ?? '',
      content: letter.rp_content ?? '',
      responsibleName: letter.rp_responsible_name ?? '',
    });
  }, [open, letter, form]);

  async function submit() {
    if (!letter) return;
    const v = await form.validateFields();
    setBusy(true);
    try {
      await api.patch(`/requests/${letter.id}/rp-letter-text`, {
        letterDate: v.letterDate ? v.letterDate.format('YYYY-MM-DD') : null,
        subject: v.subject,
        content: v.content || null,
        responsibleName: v.responsibleName || null,
      });
      message.success('Письмо обновлено');
      onSaved();
      onClose();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Редактирование письма${letter?.payhub_reg_number ? ` ${letter.payhub_reg_number}` : ''}`}
      open={open}
      onCancel={onClose}
      onOk={submit}
      confirmLoading={busy}
      okText="Сохранить"
      width={modalWidth(560)}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="letterDate" label="Дата письма">
          <DatePicker format="DD.MM.YYYY" style={{ width: 200 }} />
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
    </Modal>
  );
}
