import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLinkCode, isLinkCode, formatLinkCode, remainingSeconds, LINK_CODE_ALPHABET, LINK_CODE_TTL_MS } from '../src/features/discord/linkCode.mjs';

test('link codes match the Firestore rule format and avoid confusing characters', () => {
  assert.equal(LINK_CODE_ALPHABET.length, 32);
  for (const ch of 'IO01') assert.ok(!LINK_CODE_ALPHABET.includes(ch));
  for (let i = 0; i < 500; i++) {
    const code = generateLinkCode();
    assert.ok(isLinkCode(code), code);
  }
  // every byte value maps into the alphabet
  assert.equal(generateLinkCode(() => Uint8Array.from([0, 31, 32, 255, 64, 100, 200, 7])), 'A9A9AEJH');
  for (const bad of ['abcd2345', 'ABCD234', 'ABCD2341', 'ABCD234O', null]) assert.equal(isLinkCode(bad), false);
});

test('link code display and countdown', () => {
  assert.equal(formatLinkCode('ABCD2345'), 'ABCD-2345');
  assert.equal(remainingSeconds(0, 0), LINK_CODE_TTL_MS / 1000);
  assert.equal(remainingSeconds(0, LINK_CODE_TTL_MS - 1500), 2);
  assert.equal(remainingSeconds(0, LINK_CODE_TTL_MS + 5000), 0);
});
