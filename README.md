# TeleShop — Multi-Merchant Telegram Commerce Platform

A multi-merchant Telegram commerce platform starter built for **Cloudflare Workers Static Assets** and **Supabase**.

Merchants sign up, manage physical products and inventory, and connect their own Telegram bot created via [@BotFather](https://t.me/BotFather).

---

## Architecture Overview

```text
[ Telegram Customers ] ──(messages)──► [ Supabase Edge Function: telegram-webhook ]
                                                        │ (decrypts bot token)
                                                        ▼
[ Cloudflare Workers Static Assets ]     [ Supabase PostgreSQL + RLS + Storage ]
 (Vanilla HTML, CSS, JS Dashboard)                      ▲
             │                                          │
             └───────────(authenticated PostgREST)──────┘
```

- **Frontend:** Vanilla HTML, CSS, and JavaScript (ES modules) hosted on Cloudflare Workers Static Assets. Fast, zero-build, and lightweight.
- **Backend:** Shared Supabase project (Auth, PostgreSQL with Row Level Security, Edge Functions).
- **Security:** Each merchant's catalog is isolated using PostgreSQL RLS policies (`auth.uid()`). Telegram bot tokens are encrypted server-side with AES-GCM (256-bit) and are never exposed to browser clients.

---

## Platform Owner Setup Guide

As the platform owner, you provide a single shared Supabase backend for all merchants on the platform.

### Step 1: Database Setup
1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Note your **Project URL** and **Publishable (anon) Key** from **Project Settings > API**.
3. Apply the database migration:
   ```powershell
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```
   *(Or copy the contents of `supabase/migrations/20261102000000_initial.sql` into the Supabase SQL Editor and execute it).*

### Step 2: Edge Function Secrets & Encryption Key
1. Generate a cryptographically secure 32-byte AES encryption key:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. In your Supabase Dashboard, go to **Edge Functions > Secrets**, and add:
   - `BOT_ENCRYPTION_KEY`: The base64 key generated above.
3. Deploy the Edge Functions:
   ```powershell
   npx supabase functions deploy connect-bot
   npx supabase functions deploy telegram-webhook
   ```

### Step 3: Frontend Configuration
1. Open `public/config.js` in your editor.
2. Replace the placeholder values with your shared Supabase credentials:
   ```javascript
   export const platformConfig = {
     supabaseUrl: "https://your-project.supabase.co",
     supabaseAnonKey: "your-supabase-publishable-key"
   };
   ```
3. **Security Rule:** Never put your `service_role` secret key or `BOT_ENCRYPTION_KEY` in `public/config.js` or any frontend file.

---

## Local Development & Testing

### Running the Frontend Locally
```powershell
npx --yes http-server public -p 8080 -c-1
```
Open [http://localhost:8080](http://localhost:8080) in your browser.

### Running Automated Security & Unit Tests
A local test suite validates RLS policies, input constraints, AES-GCM encryption, and webhook rollbacks:
```powershell
npm test
```

---

## Cloudflare Workers Static Assets Deployment

Deploy the `./public` directory directly to Cloudflare:
```powershell
npx wrangler deploy
```
Wrangler will use your configured Cloudflare authentication (`wrangler login` or `CLOUDFLARE_API_TOKEN`) and serve `public/` on your `*.workers.dev` subdomain.

---

## Multi-Merchant Testing Procedure

To verify data isolation between different merchants:

1. **Merchant 1 Verification:**
   - Open the dashboard in an incognito window and click **Create merchant account** (e.g. `merchant1@test.com`).
   - Add a product: "Merchant 1 Coffee Mug", 1500 MMK, Stock: 20.
   - Connect a test bot created with @BotFather.
   - Send `/start` to the bot in Telegram. Confirm it replies with the setup welcome message.

2. **Merchant 2 Verification:**
   - Open a separate browser window and register a second account (e.g. `merchant2@test.com`).
   - Confirm Merchant 2's catalog is empty (Merchant 1's "Coffee Mug" is hidden by RLS).
   - Add a product: "Merchant 2 Leather Bag", 50000 MMK, Stock: 5.
   - Connect a distinct second bot.
   - Send `/start` to the second bot.

3. **Cross-Tenant Security Check:**
   - Sign back in as Merchant 1. Verify you only see "Coffee Mug".
   - Attempts to query or modify Merchant 2's data will fail at the database level due to PostgreSQL RLS policies.

---

## Bot Connection & Rollback Behavior

When a merchant connects a bot:
1. `connect-bot` calls Telegram `getMe` to verify the token.
2. Token is encrypted with AES-GCM and saved along with bot metadata in the database.
3. `connect-bot` registers the webhook URL on Telegram (`setWebhook`).

### Rollback on Failure
- If `setWebhook` fails or times out after database records are created, an **automatic rollback** deletes the pending rows from `bot_secrets` and `bots`. The merchant receives a descriptive error message and can immediately retry.

### Remaining Edge Cases Needing Manual Recovery
- **Database Partition during Rollback:** If the database becomes completely unreachable *while* executing the rollback after a Telegram failure, an orphaned row could remain. In this rare case, the platform administrator must manually delete the row for that merchant ID from the `bots` table in the Supabase Dashboard.
- **Telegram Bot Token Revocation:** If a merchant revokes their bot token in @BotFather, Telegram rejects future webhook calls. The merchant must contact the administrator to reset their bot connection.

---

## Project Status

- [x] **Milestone 1:** Multi-merchant authentication, platform-wide configuration, product CRUD, AES-GCM encrypted bot connection, atomic rollbacks, and RLS test suite.
- [ ] **Milestone 2 (Next):** Interactive customer shopping in Telegram, order placement, Cash on Delivery, manual payment verification (receipt upload), and merchant order management dashboard.
