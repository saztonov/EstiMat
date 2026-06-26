import { memo, useCallback, useMemo, type ComponentProps, type RefObject } from 'react';
import { CostTypeGroupBlock } from '../components/CostTypeGroupBlock';
import type { CostTypeGroup } from '../components/types';
import {
  useEstimateExpandStore,
  useExpandedWorkKeys,
  typeKeyOf,
} from '../../../store/estimateExpandStore';

// Пропсы CostTypeGroupBlock, общие для всех блоков сметы (стабильный объект из SmetaPanel).
// Раскрытие материалов и свёрнутость вида адаптер подставляет сам из estimateExpandStore.
type SharedBlockProps = Omit<
  ComponentProps<typeof CostTypeGroupBlock>,
  'group' | 'index' | 'collapsed' | 'onToggleCollapsed' | 'expandedWorkIds' | 'onWorkExpandChange' | 'scrollRootRef'
>;

interface Props {
  group: CostTypeGroup;
  index: number;
  blockProps: SharedBlockProps;
  scrollRootRef: RefObject<HTMLDivElement | null>;
}

// Адаптер между SmetaPanel и CostTypeGroupBlock. Обёрнут в memo и подписан на estimateExpandStore
// узким срезом: ререндерится ТОЛЬКО когда меняется раскрытие/свёрнутость именно этого вида работ.
// Благодаря этому разворот одной работы не каскадит на весь список.
function SmetaGroupBlockImpl({ group, index, blockProps, scrollRootRef }: Props) {
  const workIds = useMemo(() => group.works.map((w) => w.id), [group.works]);
  const expandedKeys = useExpandedWorkKeys(workIds); // useShallow-срез своих работ
  // Set из стабильного (по составу) среза — CostTypeGroupBlock работает в управляемом режиме.
  const expandedWorkIds = useMemo(() => new Set(expandedKeys), [expandedKeys]);
  const collapsed = useEstimateExpandStore((s) => s.collapsedTypes.has(typeKeyOf(group.costTypeId)));
  const setWorkExpanded = useEstimateExpandStore((s) => s.setWorkExpanded);
  const toggleType = useEstimateExpandStore((s) => s.toggleType);
  const onToggleCollapsed = useCallback(
    () => toggleType(typeKeyOf(group.costTypeId)),
    [toggleType, group.costTypeId],
  );

  return (
    <CostTypeGroupBlock
      {...blockProps}
      group={group}
      index={index}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      expandedWorkIds={expandedWorkIds}
      onWorkExpandChange={setWorkExpanded}
      scrollRootRef={scrollRootRef}
    />
  );
}

export const SmetaGroupBlock = memo(SmetaGroupBlockImpl);
