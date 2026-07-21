import { useState } from 'react';
import { Modal, Button, Space, Alert, Popconfirm, Form, Input, Typography, App } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { PROCUREMENT_ASSIGN_ROLES } from '@estimat/shared';
import { api } from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';
import { modalWidth } from '../../../lib/modalWidth';
import { ProposalView } from './ProposalView';
import type { SupplierOrderDetail } from '../types';

const { Text } = Typography;

/**
 * Этап согласования: руководитель видит предложение инженера и принимает решение.
 * Разметка предложения общая с оформленным заказом (ProposalView) — это одни и те же условия,
 * только до и после подтверждения.
 */
export function ApprovalStage({ order, number, onDone }: {
  order: SupplierOrderDetail;
  number: string;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const role = useAuthStore((s) => s.user?.role);
  const canAct = PROCUREMENT_ASSIGN_ROLES.includes(role as never);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectForm] = Form.useForm<{ comment: string }>();

  const act = useMutation({
    mutationFn: (v: { url: string; body: unknown }) => api.post(v.url, v.body),
    onSuccess: () => onDone(),
    onError: (e: Error) => message.error(e.message),
  });

  async function submitReject() {
    const v = await rejectForm.validateFields();
    await act.mutateAsync({
      url: `/supplier-orders/${order.id}/reject-approval`,
      body: { comment: v.comment, expectedVersion: order.row_version },
    });
    setRejectOpen(false);
    rejectForm.resetFields();
  }

  return (
    <>
      <Alert
        type="warning" showIcon style={{ marginBottom: 12 }}
        message="Заказ ждёт подтверждения руководителя"
        description={order.approval_requested_by_name
          ? `Отправил: ${order.approval_requested_by_name}${order.approval_requested_at ? ` · ${new Date(order.approval_requested_at).toLocaleString('ru-RU')}` : ''}`
          : undefined}
      />

      <ProposalView order={order} />

      <Space style={{ marginTop: 12 }}>
        {canAct ? (
          <>
            <Popconfirm
              title="Подтвердить поставщика?"
              description="Заказ будет присуждён на этих условиях."
              okText="Подтвердить" cancelText="Отмена"
              onConfirm={() => act.mutate({
                url: `/supplier-orders/${order.id}/approve`,
                body: { expectedVersion: order.row_version },
              })}
            >
              <Button type="primary" loading={act.isPending}>Подтвердить</Button>
            </Popconfirm>
            <Button danger onClick={() => setRejectOpen(true)}>Отклонить</Button>
          </>
        ) : (
          <Text type="secondary">Подтверждение доступно руководителю.</Text>
        )}
      </Space>

      <Modal
        title={`Отклонить предложение по заказу ${number}`}
        open={rejectOpen}
        onCancel={() => setRejectOpen(false)}
        onOk={submitReject}
        confirmLoading={act.isPending}
        okText="Отклонить"
        okButtonProps={{ danger: true }}
        width={modalWidth(480)}
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item
            name="comment" label="Что не так"
            rules={[{ required: true, whitespace: true, message: 'Укажите причину отклонения' }]}
          >
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Заказ вернётся к сбору предложений. Поставщик и цены сохранятся — инженер сможет их поправить.
        </Text>
      </Modal>
    </>
  );
}
