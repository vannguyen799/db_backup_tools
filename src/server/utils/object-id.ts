/**
 * Mongo ObjectId shape check. Callers use it to turn "no such id" into a 404
 * instead of letting Mongoose raise a CastError, which the error filter would
 * classify as a 500.
 */
export function isObjectId(id: string | undefined | null): boolean {
  return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)
}
