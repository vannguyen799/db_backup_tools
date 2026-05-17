import { AppError } from 'truxie'

export interface ClassifiedError {
  statusCode: number
  message: string
  status?: string | null
}

export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof AppError) {
    return { statusCode: err.statusCode, message: err.message, status: err.status }
  }
  if (err instanceof Error) {
    const anyErr = err as Error & { statusCode?: number; status?: number; code?: number }
    const code = anyErr.statusCode || anyErr.status || 500
    return { statusCode: typeof code === 'number' ? code : 500, message: err.message || 'Internal Server Error' }
  }
  return { statusCode: 500, message: 'Internal Server Error' }
}
