/** Ошибки интеграции с тендерным порталом СУ-10 (контракт billhub /api/external/v1). */
export class TenderApiError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly retryable: boolean;
  constructor(message: string, httpStatus: number, code: string, retryable: boolean) {
    super(message);
    this.name = 'TenderApiError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.retryable = retryable;
  }
}

/** Интеграция не сконфигурирована (нет baseUrl/token или выключен рубильник). */
export class TenderNotConfiguredError extends Error {
  constructor(message = 'Тендерный портал не настроен') {
    super(message);
    this.name = 'TenderNotConfiguredError';
  }
}
