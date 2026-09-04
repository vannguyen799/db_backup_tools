/**
 * JSON Schema fragments for the MCP catalog.
 *
 * The handlers here validate bodies by hand rather than with a schema library,
 * so `@McpExpose({bodySchema})` is where an agent learns the shape. These are
 * the fragments shared by more than one route — keep them in step with
 * `CreateTargetInput` in backup-targets.service.ts.
 */

export const retentionSchema = {
  type: 'object',
  description: 'How many archives to keep. Older ones are deleted after a successful run.',
  properties: {
    mode: { type: 'string', enum: ['count', 'days', 'none'], default: 'count' },
    keepCount: { type: 'integer', minimum: 1, default: 7, description: 'Used when mode is "count".' },
    keepDays: { type: 'integer', minimum: 1, default: 30, description: 'Used when mode is "days".' },
  },
} as const

export const collectionFilterSchema = {
  type: 'object',
  description: 'Narrows what the dump covers. Omit to back up everything the includeDbs/excludeDbs allow.',
  properties: {
    mode: {
      type: 'string',
      enum: ['exclude', 'include'],
      default: 'exclude',
      description: '"exclude" skips the listed collections; "include" backs up only those.',
    },
    collections: {
      type: 'array',
      items: {
        type: 'object',
        required: ['db', 'name'],
        properties: {
          db: { type: 'string' },
          name: { type: 'string', description: 'Collection (MongoDB) or table (PostgreSQL).' },
        },
      },
    },
    patterns: {
      type: 'array',
      items: { type: 'string' },
      description: 'Glob patterns matched against "db.collection", e.g. "logs.*".',
    },
  },
} as const
