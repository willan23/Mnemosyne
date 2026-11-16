import type { MemoryEditContent } from '../services/memoryEditRecovery';
import { useTranslation } from '../utils/translations';
const labels = { tags: 'agentChangeTags', category: 'agentChangeCategory', semanticClusterId: 'agentChangeCluster', position: 'agentChangePosition', importance: 'agentChangeImportance', celestialType: 'agentChangeAppearance', embedding: 'agentChangeVector', embeddingModel: 'agentChangeVectorModel', processingMethod: 'agentChangeProcessing', taxonomyLane: 'agentChangeLane', projectStatus: 'agentChangeProject', entities: 'agentChangeEntities', color: 'agentChangeColor', scale: 'agentChangeScale', orbitRadius: 'agentChangeRadius', orbitSpeed: 'agentChangeSpeed', learning: 'agentChangeLearning' } as const;
export function AgentChangeContent({ value }: { value: MemoryEditContent }) {
  const { t } = useTranslation();
  return <div className="space-y-2">
    <p className="whitespace-pre-wrap break-words font-medium">{value.title ?? t('agentChangeNoTitle')}</p>
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans">{value.text}</pre>
    <dl className="space-y-2 text-xs">{Object.entries(value.metadata).map(([name, item]) => <div key={name}>
      <dt className="font-semibold">{name in labels ? t(labels[name as keyof typeof labels]) : name}</dt>
      <dd className="max-h-36 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(item, null, 2)}</dd>
    </div>)}</dl>
  </div>;
}
