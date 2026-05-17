type Level = 'debug' | 'info' | 'warn' | 'error'

const COLOR: Record<Level, string> = {
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
}
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function emit(level: Level, ctx: string, args: unknown[]) {
  const parts = args.map((a) =>
    a instanceof Error ? a.stack || a.message : typeof a === 'object' ? JSON.stringify(a) : String(a),
  )
  const line = `${DIM}${ts()}${RESET} ${COLOR[level]}${level.toUpperCase().padEnd(5)}${RESET} ${DIM}[${ctx}]${RESET} ${parts.join(' ')}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

function make(ctx: string) {
  return {
    debug: (...a: unknown[]) => emit('debug', ctx, a),
    info: (...a: unknown[]) => emit('info', ctx, a),
    warn: (...a: unknown[]) => emit('warn', ctx, a),
    error: (...a: unknown[]) => emit('error', ctx, a),
  }
}

export const logger = { getContext: make }
