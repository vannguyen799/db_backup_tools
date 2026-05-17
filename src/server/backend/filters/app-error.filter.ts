import type { ExceptionFilter, ExecutionContext } from 'truxie'
import type { H3Event } from 'h3'
import { classifyError } from '~/server/utils/error'

export class AppErrorFilter implements ExceptionFilter {
  catch(error: unknown, ctx: ExecutionContext): unknown {
    const { statusCode, message, status } = classifyError(error)
    const event = ctx.getNativeRequest() as H3Event
    setResponseStatus(event, statusCode, message)
    setResponseHeader(event, 'content-type', 'application/json')
    return { success: false, message, ...(status ? { status } : {}) }
  }
}
