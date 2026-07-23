import { memo, useCallback, useMemo, type ComponentProps, type RefObject } from 'react';
import { CostTypeGroupBlock } from '../components/CostTypeGroupBlock';
import type { CostTypeGroup } from '../components/types';
import {
  useEstimateExpandStore,
  useExpandedWorkKeys,
  typeKeyOf,
} from '../../../store/estimateExpandStore';
import { useVorMarksOf } from '../../../store/estimateVorMarksStore';

// Пропсы CostTypeGroupBlock, общие для всех блоков сметы (стабильный объект из SmetaPanel).
// Раскрытие материалов и свёрнутость вида адаптер подставляет сам из estimateExpandStore.
type SharedBlockProps = Omit<
  ComponentProps<typeof CostTypeGroupBlock>,
  | 'group'
  | 'index'
  | 'collapsed'
  | 'onToggleCollapsed'
  | 'expandedWorkIds'
  | 'onWorkExpandChange'
  | 'scrollRootRef'
  | 'vorByItem'
>;

interface Props {
  group: CostTypeGroup;
  index: number;
  blockProps: SharedBlockProps;
  scrollRootRef: RefObject<HTMLDivElement | null>;
}

// Адаптер между SmetaPanel и CostTypeGroupBlock. Обёрнут в memo и подписан на стор-срезы своего
// вида работ: ререндерится ТОЛЬКО когда меняется раскрытие/свёрнутость или отметки ВОР именно его
// работ. Благодаря этому ни разворот одной работы, ни поздний приход отметок «В» не каскадят на
// весь список из сотен строк.
function SmetaGroupBlockImpl({ group, index, blockProps, scrollRootRef }: Props) {
  const workIds = useMemo(() => group.works.map((w) => w.id), [group.works]);
  const expandedKeys = useExpandedWorkKeys(workIds); // useShallow-срез своих работ
  const vorByItem = useVorMarksOf(workIds); // отметки «В» только своих работ
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
      vorByItem={vorByItem}
      scrollRootRef={scrollRootRef}
    />
  );
}

export const SmetaGroupBlock = memo(SmetaGroupBlockImpl);
