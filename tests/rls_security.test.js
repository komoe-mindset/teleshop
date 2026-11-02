import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * In-memory simulation of PostgreSQL Row Level Security (RLS) engine
 * replicating the exact SQL policies declared in:
 * supabase/migrations/20261102000000_initial.sql
 */
class MockPostgresDatabase {
  constructor() {
    this.products = [];
    this.bots = [];
    this.bot_secrets = [];
  }

  // Simulates client querying `products` with auth context
  queryProducts(currentUser, operation, params = {}) {
    if (!currentUser || currentUser.role !== 'authenticated') {
      throw new Error('RLS Error: Permission denied (unauthenticated)');
    }

    const authUid = currentUser.id;

    switch (operation) {
      case 'SELECT': {
        // Policy: using (merchant_id = auth.uid())
        return this.products.filter(p => p.merchant_id === authUid);
      }

      case 'INSERT': {
        // Policy: with check (merchant_id = auth.uid())
        if (params.merchant_id !== authUid) {
          throw new Error('RLS Error: new row violates row-level security policy for table "products"');
        }
        this.products.push({ ...params, id: `prod-${Date.now()}-${Math.random()}` });
        return true;
      }

      case 'UPDATE': {
        // Policy: using (merchant_id = auth.uid()) with check (merchant_id = auth.uid())
        const target = this.products.find(p => p.id === params.id);
        if (!target || target.merchant_id !== authUid) {
          return { affectedRows: 0 }; // Postgres RLS filters out rows the user cannot access
        }
        if (params.data.merchant_id && params.data.merchant_id !== authUid) {
          throw new Error('RLS Error: updated row violates check policy');
        }
        Object.assign(target, params.data);
        return { affectedRows: 1 };
      }

      case 'DELETE': {
        // Policy: using (merchant_id = auth.uid())
        const index = this.products.findIndex(p => p.id === params.id && p.merchant_id === authUid);
        if (index === -1) {
          return { affectedRows: 0 };
        }
        this.products.splice(index, 1);
        return { affectedRows: 1 };
      }

      default:
        throw new Error('Unsupported operation');
    }
  }

  // Simulates querying `bots` table
  queryBots(currentUser, operation, params = {}) {
    if (currentUser.role === 'service_role') {
      // Server bypasses RLS
      if (operation === 'INSERT') {
        this.bots.push(params);
        return true;
      }
      if (operation === 'DELETE') {
        this.bots = this.bots.filter(b => b.merchant_id !== params.merchant_id);
        return true;
      }
    }

    if (!currentUser || currentUser.role !== 'authenticated') {
      throw new Error('RLS Error: Permission denied');
    }

    const authUid = currentUser.id;

    // Policy: create policy "merchant reads own bot" on public.bots for select to authenticated using (merchant_id = auth.uid());
    if (operation === 'SELECT') {
      return this.bots.filter(b => b.merchant_id === authUid);
    }

    // Any INSERT / UPDATE / DELETE from authenticated client is rejected (no policy exists)
    throw new Error(`RLS Error: Permission denied for table "bots" operation "${operation}". Clients are read-only.`);
  }

  // Simulates querying `bot_secrets` table
  queryBotSecrets(currentUser, operation, params = {}) {
    // Migration: revoke all on public.bot_secrets from anon, authenticated;
    if (currentUser.role === 'anon' || currentUser.role === 'authenticated') {
      throw new Error('Permission denied: relation "bot_secrets" does not grant access to role ' + currentUser.role);
    }

    if (currentUser.role === 'service_role') {
      if (operation === 'SELECT') {
        return this.bot_secrets.filter(s => s.merchant_id === params.merchant_id);
      }
      if (operation === 'INSERT') {
        this.bot_secrets.push(params);
        return true;
      }
      if (operation === 'DELETE') {
        this.bot_secrets = this.bot_secrets.filter(s => s.merchant_id !== params.merchant_id);
        return true;
      }
    }

    throw new Error('Unknown role');
  }
}

// Test merchants
const merchantA = { id: 'uuid-merchant-a', role: 'authenticated' };
const merchantB = { id: 'uuid-merchant-b', role: 'authenticated' };
const anonUser = { id: null, role: 'anon' };
const serviceRole = { id: 'admin', role: 'service_role' };

test('RLS Products: Merchant A cannot read Merchant B products', () => {
  const db = new MockPostgresDatabase();

  // Seed product for Merchant A and Merchant B
  db.queryProducts(merchantA, 'INSERT', {
    merchant_id: merchantA.id,
    name: 'Merchant A Handbag',
    price_minor: 5000,
    currency: 'USD',
    stock: 10,
  });

  db.queryProducts(merchantB, 'INSERT', {
    merchant_id: merchantB.id,
    name: 'Merchant B Coffee Beans',
    price_minor: 1200,
    currency: 'USD',
    stock: 25,
  });

  // Merchant A queries products
  const productsA = db.queryProducts(merchantA, 'SELECT');
  assert.strictEqual(productsA.length, 1);
  assert.strictEqual(productsA[0].name, 'Merchant A Handbag');

  // Merchant B queries products
  const productsB = db.queryProducts(merchantB, 'SELECT');
  assert.strictEqual(productsB.length, 1);
  assert.strictEqual(productsB[0].name, 'Merchant B Coffee Beans');
});

test('RLS Products: Merchant A cannot insert product under Merchant B merchant_id', () => {
  const db = new MockPostgresDatabase();

  assert.throws(
    () => {
      db.queryProducts(merchantA, 'INSERT', {
        merchant_id: merchantB.id, // spoofing merchant B!
        name: 'Spoofed Item',
        price_minor: 100,
        currency: 'USD',
        stock: 5,
      });
    },
    /violates row-level security policy/i,
    'Inserting with mismatched merchant_id must be denied'
  );
});

test('RLS Products: Merchant A cannot update or delete Merchant B product', () => {
  const db = new MockPostgresDatabase();

  db.queryProducts(merchantB, 'INSERT', {
    merchant_id: merchantB.id,
    name: 'Merchant B Item',
    price_minor: 2000,
    currency: 'USD',
    stock: 5,
  });

  const bProducts = db.queryProducts(merchantB, 'SELECT');
  const bProductId = bProducts[0].id;

  // Merchant A attempts to update Merchant B product
  const updateResult = db.queryProducts(merchantA, 'UPDATE', {
    id: bProductId,
    data: { name: 'Hacked name' },
  });
  assert.strictEqual(updateResult.affectedRows, 0, 'No rows should be updated');

  // Merchant A attempts to delete Merchant B product
  const deleteResult = db.queryProducts(merchantA, 'DELETE', { id: bProductId });
  assert.strictEqual(deleteResult.affectedRows, 0, 'No rows should be deleted');

  // Verify item is intact for Merchant B
  const verifyB = db.queryProducts(merchantB, 'SELECT');
  assert.strictEqual(verifyB[0].name, 'Merchant B Item');
});

test('RLS Bots: Merchant can only read their own connected bot metadata', () => {
  const db = new MockPostgresDatabase();

  // Server inserts bots for both merchants
  db.queryBots(serviceRole, 'INSERT', {
    merchant_id: merchantA.id,
    telegram_bot_id: 111111,
    username: 'MerchantABot',
  });

  db.queryBots(serviceRole, 'INSERT', {
    merchant_id: merchantB.id,
    telegram_bot_id: 222222,
    username: 'MerchantBBot',
  });

  // Merchant A query
  const botA = db.queryBots(merchantA, 'SELECT');
  assert.strictEqual(botA.length, 1);
  assert.strictEqual(botA[0].username, 'MerchantABot');

  // Merchant B query
  const botB = db.queryBots(merchantB, 'SELECT');
  assert.strictEqual(botB.length, 1);
  assert.strictEqual(botB[0].username, 'MerchantBBot');
});

test('RLS Bots: Clients cannot directly INSERT or UPDATE bots table', () => {
  const db = new MockPostgresDatabase();

  assert.throws(
    () => {
      db.queryBots(merchantA, 'INSERT', {
        merchant_id: merchantA.id,
        telegram_bot_id: 999999,
        username: 'HackedBot',
      });
    },
    /Permission denied/i,
    'Client INSERT on bots table must be rejected'
  );
});

test('RLS Bot Secrets: Anon and Authenticated clients are completely denied access', () => {
  const db = new MockPostgresDatabase();

  // Server stores secrets
  db.queryBotSecrets(serviceRole, 'INSERT', {
    merchant_id: merchantA.id,
    token_ciphertext: 'enc-ciphertext-string',
    token_iv: 'iv-string',
    webhook_secret: 'secret-string',
  });

  // Authenticated merchant tries to access bot_secrets
  assert.throws(
    () => {
      db.queryBotSecrets(merchantA, 'SELECT', { merchant_id: merchantA.id });
    },
    /Permission denied/i,
    'Authenticated merchant must not access bot_secrets'
  );

  // Anonymous user tries to access bot_secrets
  assert.throws(
    () => {
      db.queryBotSecrets(anonUser, 'SELECT', { merchant_id: merchantA.id });
    },
    /Permission denied/i,
    'Anonymous user must not access bot_secrets'
  );

  // Only service_role can read secrets
  const secrets = db.queryBotSecrets(serviceRole, 'SELECT', { merchant_id: merchantA.id });
  assert.strictEqual(secrets.length, 1);
  assert.strictEqual(secrets[0].webhook_secret, 'secret-string');
});

