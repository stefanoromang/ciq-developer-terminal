// OpenCode returns structured errors in both tool states and message errors.
// Only display the message, never the raw provider response/metadata object.
export function errorMessage(value: unknown, fallback = 'The request failed.'): string {
  if (typeof value === 'string') return value.trim() ? value : fallback
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') {
    return value.message.trim() ? value.message : fallback
  }
  return fallback
}
