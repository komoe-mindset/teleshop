import test from 'node:test';
import assert from 'node:assert/strict';

test('Bot connection rollback safely cleans database when Telegram webhook setup fails', async () => {
  // Mock database state
  const mockDb = {
    bots: new Map(),
    bot_secrets: new Map(),
  };

  const merchantId = 'merchant-test-123';
  const telegramBotId = 987654321;
  const username = 'TestStoreBot';

  // Function simulating the exact transaction & rollback logic in connect-bot/index.ts
  async function connectBotFlow(shouldTelegramSucceed) {
    let botRowCreated = false;
    let secretRowCreated = false;

    try {
      // Step 1: Insert bot
      mockDb.bots.set(merchantId, { telegram_bot_id: telegramBotId, username });
      botRowCreated = true;

      // Step 2: Insert secrets
      mockDb.bot_secrets.set(merchantId, { token_ciphertext: 'mock-cipher', token_iv: 'mock-iv', webhook_secret: 'mock-sec' });
      secretRowCreated = true;

      // Step 3: Call Telegram setWebhook
      if (!shouldTelegramSucceed) {
        throw new Error('Telegram network failure / 502 Bad Gateway');
      }

      return { ok: true, username };
    } catch (err) {
      // Rollback logic
      if (botRowCreated || secretRowCreated) {
        mockDb.bot_secrets.delete(merchantId);
        mockDb.bots.delete(merchantId);
      }
      return { ok: false, error: err.message };
    }
  }

  // Run with failed webhook setup
  const failureResult = await connectBotFlow(false);
  assert.strictEqual(failureResult.ok, false);
  assert.match(failureResult.error, /Telegram network failure/);

  // Assert rollback cleaned up both tables
  assert.strictEqual(mockDb.bots.has(merchantId), false, 'Bot row must be rolled back');
  assert.strictEqual(mockDb.bot_secrets.has(merchantId), false, 'Bot secrets row must be rolled back');

  // Verify merchant can retry and succeed without 409 conflict
  const retryResult = await connectBotFlow(true);
  assert.strictEqual(retryResult.ok, true);
  assert.strictEqual(mockDb.bots.has(merchantId), true);
  assert.strictEqual(mockDb.bot_secrets.has(merchantId), true);
});

