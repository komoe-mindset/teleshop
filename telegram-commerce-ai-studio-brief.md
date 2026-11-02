# Telegram Commerce — Project Brief for TeleShop

## Goal
Build a responsive, multi-merchant Telegram commerce platform. Merchants create an account, connect their own BotFather bot, manage physical products and inventory, view orders, and edit FAQs. A Telegram customer can browse products and place an order. Begin with physical products and manual payment or cash on delivery unless the owner chooses otherwise. A manual payment is pending until the merchant confirms receipt.

## Architecture & Technology Stack
- **Frontend Dashboard:** Pure HTML, CSS, and Vanilla JavaScript (ES modules) hosted via Cloudflare Workers Static Assets (`wrangler.toml`). Zero build step, fast loading, and highly portable. *(Note: React/Vite is deliberately deferred to avoid unnecessary bundler complexity in Milestone 1).*
- **Backend:** Shared Supabase project with Supabase Auth, PostgreSQL (with strict Row Level Security), Storage, and TypeScript/Deno Edge Functions.
- **Telegram Bot Webhooks:** Handled securely via a Supabase Edge Function (`telegram-webhook`). Bot tokens are encrypted using AES-GCM (256-bit) and stored exclusively in a server-only secrets table with no client access.
- **Platform Configuration:** One central configuration (`public/config.js`) for the shared Supabase project URL and anon key.

## Milestone 1 (Foundation — Completed)
1. Sign up, sign in, sign out; authenticated merchant dashboard with clear loading and error feedback.
2. Single platform-wide Supabase configuration in `public/config.js` (merchants never configure database URLs).
3. Merchant workspace isolation using explicit PostgreSQL Row Level Security (RLS) policies (`auth.uid()`).
4. Physical Product CRUD: name, description, currency, price in integer minor units, stock quantity, and active status. Validated on client and database.
5. Bot connection flow with Telegram `getMe` verification, AES-GCM 256-bit encryption, Telegram webhook registration, and automatic database rollback on network/API failure.
6. Local automated test suite verifying RLS policies, cryptographic roundtrips, input constraints, and rollback logic.

## Milestone 2 (Coming Next)
- **Telegram Bot Shopping:** Interactive `/start`, product catalog browsing with pagination and photos, inline cart selection, and customer contact/delivery address collection.
- **Orders & Inventory:** Atomic stock decrement (`create_order_atomic` PostgreSQL function) to prevent overselling; order snapshotting (freezing product name and unit price at time of purchase).
- **Payment Methods:**
  - Cash on Delivery (COD).
  - Manual Payment Verification (customer uploads screenshot of payment slip; stored in Supabase Storage; merchant reviews and verifies in dashboard).
- **Merchant Order Feed:** Live order feed with real-time status updates and order state management (`pending_payment`, `confirmed`, `shipped`, `delivered`).
- **Storefront FAQs:** Merchant-managed FAQ questions and answers accessible via the Telegram bot.

## Security Rules
- Use only public Supabase project URL and publishable key in `public/config.js`.
- Never put Supabase service-role secret keys, database passwords, or bot encryption keys in the frontend repository or prompt chats.
- Enable and test Row Level Security on all exposed tables.
