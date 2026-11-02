import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const crypto = webcrypto;

// Helper functions mirroring Deno Edge Function
const encodeBase64 = (bytes) => Buffer.from(bytes).toString('base64');
const decodeBase64 = (str) => new Uint8Array(Buffer.from(str, 'base64'));

async function encryptToken(token, rawKeyBytes) {
  const key = await crypto.subtle.importKey('raw', rawKeyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(token)
  );
  return {
    ciphertext: encodeBase64(new Uint8Array(ciphertextBuffer)),
    iv: encodeBase64(iv),
  };
}

async function decryptToken(ciphertext64, iv64, rawKeyBytes) {
  const key = await crypto.subtle.importKey('raw', rawKeyBytes, 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64(iv64) },
    key,
    decodeBase64(ciphertext64)
  );
  return new TextDecoder().decode(decrypted);
}

test('Telegram bot token format validation regex', () => {
  const tokenRegex = /^\d{5,20}:[A-Za-z0-9_-]{20,100}$/;

  // Valid tokens
  assert.ok(tokenRegex.test('123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567'));
  assert.ok(tokenRegex.test('9876543210:AAFl1234-xyz_ABCD9876543210qwertyuiop'));

  // Invalid tokens
  assert.strictEqual(tokenRegex.test(''), false, 'Empty string should fail');
  assert.strictEqual(tokenRegex.test('1234:short'), false, 'Bot ID too short');
  assert.strictEqual(tokenRegex.test('notatoken'), false, 'Missing colon and structure');
  assert.strictEqual(tokenRegex.test('123456789:contains spaces in token!'), false, 'Spaces and special chars');
});

test('AES-GCM 256-bit encryption and decryption roundtrip', async () => {
  const rawKey = crypto.getRandomValues(new Uint8Array(32)); // 256 bits
  const originalToken = '7123456789:ABCdef-GHI_jklMNOpqrsTUV1234567890';

  const { ciphertext, iv } = await encryptToken(originalToken, rawKey);

  // Assert ciphertext is base64 and not plaintext
  assert.notStrictEqual(ciphertext, originalToken);
  assert.ok(ciphertext.length > 20);

  // Assert decryption returns exact original token
  const decrypted = await decryptToken(ciphertext, iv, rawKey);
  assert.strictEqual(decrypted, originalToken);
});

test('AES-GCM rejects decryption with wrong key or tampered data', async () => {
  const correctKey = crypto.getRandomValues(new Uint8Array(32));
  const wrongKey = crypto.getRandomValues(new Uint8Array(32));
  const token = '1234567890:SampleValidTokenStringForTesting123456';

  const { ciphertext, iv } = await encryptToken(token, correctKey);

  // Attempt decryption with wrong key -> must throw
  await assert.rejects(
    async () => {
      await decryptToken(ciphertext, iv, wrongKey);
    },
    /operation failed|bad decrypt|tag check/i,
    'Decryption with incorrect key must fail'
  );

  // Attempt decryption with tampered ciphertext -> must throw
  const tamperedCiphertext = ciphertext.slice(0, -4) + 'AAAA';
  await assert.rejects(
    async () => {
      await decryptToken(tamperedCiphertext, iv, correctKey);
    },
    'Tampered ciphertext must fail authentication tag check'
  );
});

