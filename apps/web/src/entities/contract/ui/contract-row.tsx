'use client'

import type { ContractWithRelations } from '@estimat/shared'
import { ContractStatusBadge } from './contract-status-badge'

interface ContractRowProps {
  contract: ContractWithRelations
  onClick?: (contract: ContractWithRelations) => void
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014'
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatAmount(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '\u2014'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function ContractRow({ contract, onClick }: ContractRowProps) {
  return (
    <tr
      className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer transition-colors"
      onClick={() => onClick?.(contract)}
    >
      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
        {contract.number}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
        {contract.supplier?.name ?? '\u2014'}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
        {formatDate(contract.date)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
        {formatDate(contract.valid_until)}
      </td>
      <td className="px-4 py-3">
        <ContractStatusBadge status={contract.status} />
      </td>
      <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-gray-100">
        {formatAmount(contract.total_amount)}
      </td>
    </tr>
  )
}

/** Table header matching ContractRow columns */
export function ContractRowHeader() {
  return (
    <tr className="border-b border-gray-200 dark:border-gray-800">
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Номер
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Поставщик
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Дата начала
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Дата окончания
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Статус
      </th>
      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Сумма
      </th>
    </tr>
  )
}
