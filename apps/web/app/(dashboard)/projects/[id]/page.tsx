import { ProjectDashboardWidget } from '@/widgets/project-dashboard'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params
  return <ProjectDashboardWidget projectId={id} />
}
