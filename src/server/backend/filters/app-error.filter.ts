import type { ExceptionFilter, ExecutionContext } from 'truxie'
import type { H3Event } from 'h3'
import { classifyError } from '~/server/utils/error'

export class AppErrorFilter implements ExceptionFilter {
  catch(error: unknown, ctx: ExecutionContext): unknown {
    const { statusCode, message, status } = classifyError(error)

    // The cross-adapter channel: the Nitro dispatcher and @truxie/mcp both read
    // this key to decide the status of a handled error.
    ctx.setData('__statusCode', statusCode)

    // Over HTTP, also set the reason phrase and content type. Under MCP the
    // native request is a Web Request with no `node.res` to write to.
    const event = ctx.getNativeRequest() as H3Event | undefined
    if (event?.node?.res) {
      setResponseStatus(event, statusCode, message)
      setResponseHeader(event, 'content-type', 'application/json')
    }

    return { success: false, message, ...(status ? { status } : {}) }
  }
}
