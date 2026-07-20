import { App, Select } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { CipherTags } from '../../../components/CipherTags';

interface Cipher {
  id: string;
  code: string;
}

interface Props {
  estimateId: string;
  projectId: string;
  costTypeId: string;
  /** Назначенные виду работ шифры (из детализации сметы). */
  value: Cipher[];
  /** Право редактировать (роль admin/engineer). false — только просмотр тегами. */
  canEdit: boolean;
}

// Шифры РД у вида работ: мультиселект из шифров объекта (для admin/engineer) либо теги (просмотр).
// Значение хранится связкой (estimate + cost_type); опции берутся из справочника шифров объекта.
export function CostTypeCipherSelect({ estimateId, projectId, costTypeId, value, canEdit }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['project-ciphers', projectId],
    queryFn: () => api.get<{ data: Cipher[] }>(`/projects/${projectId}/ciphers`),
    enabled: canEdit,
  });

  const mutation = useMutation({
    mutationFn: (cipherIds: string[]) =>
      api.put(`/estimates/${estimateId}/cost-types/${costTypeId}/ciphers`, { cipherIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['project-estimate', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-ciphers', projectId] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  // Просмотр — теми же тремя тегами со свёрткой «+N», что и режим правки (maxTagCount={3}):
  // иначе у вида работ с десятком шифров шапка блока разъезжалась бы на несколько строк.
  if (!canEdit) return <CipherTags codes={value.map((c) => c.code)} />;

  const options = (data?.data ?? []).map((c) => ({ value: c.id, label: c.code }));

  return (
    <Select
      mode="multiple"
      size="small"
      placeholder="Шифры РД"
      style={{ minWidth: 160, maxWidth: 480 }}
      maxTagCount={3}
      value={value.map((c) => c.id)}
      options={options}
      onChange={(ids) => mutation.mutate(ids)}
      loading={mutation.isPending}
      optionFilterProp="label"
      showSearch
    />
  );
}
