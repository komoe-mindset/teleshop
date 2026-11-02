import test from 'node:test';
import assert from 'node:assert/strict';
import { isConfigured, platformConfig } from '../public/config.js';

// Validation helpers mirroring app.js and database constraints
function validateProduct(product) {
  const errors = [];
  const name = product.name?.trim();
  const description = product.description ?? '';
  const price = product.price_minor;
  const currency = product.currency?.trim().toUpperCase();
  const stock = product.stock;

  // Name check: 1 to 120 chars
  if (!name || name.length > 120) {
    errors.push('Name must be between 1 and 120 characters');
  }

  // Description check: <= 2000 chars
  if (description.length > 2000) {
    errors.push('Description must not exceed 2000 characters');
  }

  // Price minor check: integer between 0 and 1,000,000,000
  if (!Number.isInteger(price) || price < 0 || price > 1000000000) {
    errors.push('Price must be an integer between 0 and 1,000,000,000');
  }

  // Currency check: 3 uppercase letters
  if (!/^[A-Z]{3}$/.test(currency)) {
    errors.push('Currency must be 3 uppercase letters');
  }

  // Stock check: integer between 0 and 1,000,000
  if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) {
    errors.push('Stock must be an integer between 0 and 1,000,000');
  }

  return { isValid: errors.length === 0, errors };
}

test('Product validation succeeds with valid input', () => {
  const validProduct = {
    name: 'Wireless Bluetooth Earbuds',
    description: 'Noise cancelling with 24-hour battery life.',
    price_minor: 4999, // $49.99
    currency: 'USD',
    stock: 50,
  };

  const { isValid, errors } = validateProduct(validProduct);
  assert.strictEqual(isValid, true);
  assert.strictEqual(errors.length, 0);
});

test('Product validation rejects empty or oversized names', () => {
  assert.strictEqual(validateProduct({ name: '', price_minor: 100, currency: 'MMK', stock: 1 }).isValid, false);
  assert.strictEqual(validateProduct({ name: '   ', price_minor: 100, currency: 'MMK', stock: 1 }).isValid, false);
  assert.strictEqual(validateProduct({ name: 'A'.repeat(121), price_minor: 100, currency: 'MMK', stock: 1 }).isValid, false);
});

test('Product validation enforces price minor unit boundaries', () => {
  assert.strictEqual(validateProduct({ name: 'Item', price_minor: -1, currency: 'USD', stock: 1 }).isValid, false);
  assert.strictEqual(validateProduct({ name: 'Item', price_minor: 10.5, currency: 'USD', stock: 1 }).isValid, false);
  assert.strictEqual(validateProduct({ name: 'Item', price_minor: 1000000001, currency: 'USD', stock: 1 }).isValid, false);
  assert.strictEqual(validateProduct({ name: 'Item', price_minor: 0, currency: 'USD', stock: 1 }).isValid, true);
});

test('Product validation enforces 3-letter uppercase currency codes', () => {
  assert.strictEqual(validateProduct({ name: 'Item', price_minor: 100, currency: 'usd', stock: 1 }).isValid, true, 'Lower case should be normalized to upper');
  assert.strictEqual(validateProduct({ name: 'Item', price_minor: 100, currency: 'US', stock: 1 }).isValid, false);
  assert.strictEqual(validateProduct({ name: 'Item', price_minor: 100, currency: 'USDT', stock: 1 }).isValid, false);
  assert.strictEqual(validateProduct({ name: 'Item', price_minor: 100, currency: 'U$D', stock: 1 }).isValid, false);
});

test('Platform configuration check detects unconfigured placeholder values', () => {
  // Default placeholder values must be flagged as unconfigured
  assert.strictEqual(isConfigured(), false);
});

