'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signUp } from '@/features/auth'

export function RegisterFormWidget() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    if (password.length < 6) {
      setError('Пароль должен содержать не менее 6 символов.')
      setLoading(false)
      return
    }

    try {
      const { error: signUpError } = await signUp(email, password, fullName)

      if (signUpError) {
        setError(getErrorMessage(signUpError.message))
        return
      }

      setSuccess(true)
    } catch {
      setError('Произошла непредвиденная ошибка. Попробуйте позже.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div>
        <h2 className="mb-4 text-center text-2xl font-semibold text-card-foreground">
          Регистрация завершена
        </h2>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          На ваш адрес электронной почты отправлено письмо для подтверждения.
          Пожалуйста, проверьте вашу почту и перейдите по ссылке для активации
          аккаунта.
        </p>
        <Link
          href="/login"
          className="block w-full rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Перейти к входу
        </Link>
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-6 text-center text-2xl font-semibold text-card-foreground">
        Регистрация
      </h2>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="fullName"
            className="mb-1 block text-sm font-medium text-card-foreground"
          >
            Полное имя
          </label>
          <input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            placeholder="Иванов Иван Иванович"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="mb-1 block text-sm font-medium text-card-foreground"
          >
            Электронная почта
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="email@example.com"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1 block text-sm font-medium text-card-foreground"
          >
            Пароль
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="Не менее 6 символов"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Регистрация...' : 'Зарегистрироваться'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        Уже есть аккаунт?{' '}
        <Link
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          Войти
        </Link>
      </p>
    </div>
  )
}

function getErrorMessage(message: string): string {
  if (message.includes('User already registered')) {
    return 'Пользователь с таким адресом электронной почты уже зарегистрирован.'
  }
  if (message.includes('Password should be at least')) {
    return 'Пароль должен содержать не менее 6 символов.'
  }
  if (message.includes('Unable to validate email')) {
    return 'Некорректный адрес электронной почты.'
  }
  if (message.includes('Too many requests')) {
    return 'Слишком много попыток. Попробуйте позже.'
  }
  return 'Ошибка регистрации. Попробуйте позже.'
}
