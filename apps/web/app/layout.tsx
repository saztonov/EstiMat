import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { QueryProvider } from '@/shared/providers/query-provider'
import './globals.css'

const inter = Inter({ subsets: ['latin', 'cyrillic'] })

export const metadata: Metadata = {
  title: 'EstiMat',
  description: 'Система автоматизации закупки материалов',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <body className={inter.className}>
        <QueryProvider>
          {children}
        </QueryProvider>
      </body>
    </html>
  )
}
