/** Ошибка внешнего API PayHub. retryable — временная (сеть/5xx/429), команду стоит повторить. */
export class PayHubApiError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly retryable: boolean;
  constructor(message: string, httpStatus: number, code: string, retryable: boolean) {
    super(message);
    this.name = 'PayHubApiError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.retryable = retryable;
  }
}

/** Интеграция PayHub не настроена (нет PAYHUB_BASE_URL/PAYHUB_API_TOKEN). */
export class PayHubNotConfiguredError extends Error {
  constructor(message = 'Интеграция PayHub не настроена') {
    super(message);
    this.name = 'PayHubNotConfiguredError';
  }
}

/**
 * Нехватка конфигурации для отправки РП (не выбран отправитель / объект не сопоставлен с
 * проектом-получателем PayHub / недостаточный scope ключа). Не ретраится — письмо в waiting_config.
 */
export class PayHubWaitingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayHubWaitingConfigError';
  }
}
