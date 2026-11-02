# Telegram Commerce — project brief for Google AI Studio

## Goal
Build a responsive, multi-merchant Telegram commerce platform. Merchants create an account, connect their own BotFather bot, manage products and inventory, view orders, and edit FAQs. A Telegram customer can browse products and place an order. Begin with physical products and manual payment or cash on delivery unless the owner chooses otherwise. A manual payment is pending until the merchant confirms receipt.

## Stack
- React + TypeScript + Vite single-page dashboard, suitable for Cloudflare Workers Static Assets.
- Supabase Auth, Postgres, Storage and Edge Functions (TypeScript/Deno).
- Telegram Bot API webhooks handled by a Supabase Edge Function. No Node-only server in the frontend deployment.
- Keep configurations in environment variables and provide .env.example with placeholders only. Never ask for secrets in prompts.

## Build milestone 1 first
1. Sign up, sign in, sign out; authenticated merchant dashboard and clear loading/error states.
2. Create a merchant workspace. Isolate every merchant's data using explicit Postgres row-level security policies.
3. Product CRUD: name, description, currency, price in integer minor units, stock quantity, and active status. Validate on server as well as client.
4. Provide database migrations, RLS policies, environment variable instructions, README and minimal tests. Run a production build and report the result.
5. Show bot, orders, FAQ and CSV navigation as Coming soon until actually implemented. Do not claim a button works when it does not.

## Later milestones
- Secure bot connection: authenticated Edge Function validates a token with Telegram getMe. Store tokens encrypted in a server-only secret store, never in browser-readable tables, logs, URLs or source control. Install webhook with setWebhook using an independently random secret_token; verify the X-Telegram-Bot-Api-Secret-Token header for every request. Provide safe disconnect and explain it changes the bot's webhook. Only one webhook per bot can be active.
- Telegram bot: /start, category or product list, product details, quantity, checkout and customer contact information. Respond to callbacks promptly. Ensure webhook updates can be retried without duplicate orders.
- Orders: snapshot prices and product names, keep order and payment statuses distinct, check prices and merchant ownership on server, atomically manage stock so concurrent checkouts cannot oversell. No actual payment integration until chosen and tested.
- FAQ: merchant-managed questions and answers plus support contact.
- CSV import/export: template, validated preview, clear errors, protection against spreadsheet formula injection in exported text, and merchant isolation.
- If digital goods are added, use Telegram Stars for sales inside Telegram; implement verified successful_payment handling, fulfillment and payment support. Do not claim payment is working before it is tested.

## Security and operations
- Use the public Supabase project URL and publishable key in the frontend; never put service-role/secret keys or bot tokens there. Enable RLS on exposed tables and test cross-merchant access.
- Enforce authorization in every privileged function. Validate webhook secret, deduplicate updates, and avoid logging personal data and tokens.
- Configure HTTPS, persistent data, backups, operational monitoring, rate limits, and a webhook retry/recovery strategy. Document what is actually tested.
- Describe deployment steps for Supabase migrations/functions and Cloudflare Workers Static Assets. Avoid assuming that a Google AI Studio preview server will run unchanged on Cloudflare.

## Request to AI Studio
Build milestone 1 only, with a polished dark dashboard inspired by the reference but original branding. Include a mobile layout, accessible labels, useful empty states, and a real setup guide. Ask before adding any paid external service. Explain what is implemented, what is mocked, and what remains. Do not request real secrets in chat.
