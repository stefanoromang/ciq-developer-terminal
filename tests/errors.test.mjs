import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorMessage } from '../src/errors.ts'

test('structured and legacy errors render as messages, never as objects or raw responses', () => {
  assert.equal(errorMessage({ type: 'ToolError', message: 'File unavailable', response: { secret: 'hidden' } }), 'File unavailable')
  assert.equal(errorMessage('Legacy error'), 'Legacy error')
  assert.equal(errorMessage(new Error('Native error')), 'Native error')
  for (const value of [null, undefined, {}, [], 42, { message: {} }, { message: ' ' }, { response: 'hidden' }]) {
    assert.equal(errorMessage(value, 'Request failed'), 'Request failed')
  }
})
