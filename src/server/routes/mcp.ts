import { mcpEnabled, mcpHandler } from '$/mcp'

/**
 * The MCP endpoint. Mounted beside the controller dispatcher rather than under
 * it: @truxie/mcp authenticates its own callers and then dispatches in-process
 * through the same guard chain the HTTP routes run.
 */
export default defineEventHandler(async (event) => {
  if (!mcpEnabled) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  const response = await mcpHandler.handle(toWebRequest(event))
  return sendWebResponse(event, response)
})
