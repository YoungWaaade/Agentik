import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeHref, trimUrl, isPath } from '../src/links.js';

test('web links are kept, localhost included', () => {
  assert.equal(safeHref('http://localhost:4399'), 'http://localhost:4399/');
  assert.equal(safeHref('https://github.com/YoungWaaade/Agentik'), 'https://github.com/YoungWaaade/Agentik');
});

test('every other scheme is blocked', () => {
  for (const h of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'vbscript:x', '/Users/alice', 'http://localhost:4399,']) assert.equal(safeHref(h), null, h);
});

test('a bare URL leaves the sentence punctuation out', () => {
  assert.equal(trimUrl('http://localhost:4399,'), 'http://localhost:4399');
  assert.equal(trimUrl('http://localhost:4399.'), 'http://localhost:4399');
  assert.equal(trimUrl('https://x.com/a?node-id=1-2.'), 'https://x.com/a?node-id=1-2');
  assert.equal(trimUrl('https://x.com/tiktok`.'), 'https://x.com/tiktok');
  assert.equal(trimUrl('https://x.com/a)'), 'https://x.com/a');
  assert.equal(trimUrl('https://en.wikipedia.org/wiki/A_(b)'), 'https://en.wikipedia.org/wiki/A_(b)');
});

test('local paths are recognised', () => {
  for (const h of ['/Users/alice/a.png', '~/x', './a', 'file:///a']) assert.ok(isPath(h), h);
  assert.ok(!isPath('https://x.com'));
});
