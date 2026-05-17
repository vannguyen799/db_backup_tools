export interface ApiSuccess<T> {
  success: true
  data: T
  message?: string
}

export function sendSuccess<T>(data: T, message?: string): ApiSuccess<T> {
  return { success: true, data, ...(message ? { message } : {}) }
}
