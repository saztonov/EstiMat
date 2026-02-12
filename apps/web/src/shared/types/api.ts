export interface ApiResponse<T> {
  data?: T
  error?: { message: string; details?: unknown }
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  limit: number
}
