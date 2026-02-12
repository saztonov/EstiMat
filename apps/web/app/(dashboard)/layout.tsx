import { redirect } from 'next/navigation'
import { createClient } from '@/shared/lib/supabase/server'
import { DashboardLayout } from '@/shared/layouts/dashboard-layout'

export default async function DashboardRouteLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return <DashboardLayout>{children}</DashboardLayout>
}
