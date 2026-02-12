import { AuthLayout } from '@/shared/layouts/auth-layout'

export default function AuthRouteLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AuthLayout>{children}</AuthLayout>
}
