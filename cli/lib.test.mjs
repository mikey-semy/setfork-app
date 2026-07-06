import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseUrl, cloneUrl, pageUrl, parseRef, rawUrl } from './lib.mjs'

test('parseRef owner/slug', () => assert.deepEqual(parseRef('alice/deploy'), { owner: 'alice', slug: 'deploy' }))
test('parseRef strips .git', () => assert.deepEqual(parseRef('alice/deploy.git'), { owner: 'alice', slug: 'deploy' }))
test('parseRef leading slash', () => assert.deepEqual(parseRef('/alice/deploy'), { owner: 'alice', slug: 'deploy' }))
test('parseRef from full url + extra path', () =>
  assert.deepEqual(parseRef('https://setfork.com/alice/deploy/issues/3'), { owner: 'alice', slug: 'deploy' }))
test('parseRef rejects bad input', () => {
  assert.throws(() => parseRef('nope'))
  assert.throws(() => parseRef(''))
  assert.throws(() => parseRef('a/'))
})

test('baseUrl default', () => assert.equal(baseUrl({}), 'https://setfork.com'))
test('baseUrl env override strips trailing slash', () => assert.equal(baseUrl({ SETFORK_URL: 'http://localhost:3000/' }), 'http://localhost:3000'))

test('cloneUrl', () => assert.equal(cloneUrl('a/b', {}), 'https://setfork.com/a/b.git'))
test('rawUrl', () => assert.equal(rawUrl('a/b', {}), 'https://setfork.com/a/b/raw'))
test('pageUrl', () => assert.equal(pageUrl('a/b', {}), 'https://setfork.com/a/b'))
test('urls honor SETFORK_URL', () => assert.equal(cloneUrl('a/b', { SETFORK_URL: 'http://localhost:3000' }), 'http://localhost:3000/a/b.git'))
