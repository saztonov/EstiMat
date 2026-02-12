import { ProjectMembersWidget } from '@/widgets/project-members'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectMembersPage({ params }: Props) {
  const { id } = await params
  return <ProjectMembersWidget projectId={id} />
}
