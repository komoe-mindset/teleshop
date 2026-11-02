# TeleShop starter — milestone 1

A starter for multiple merchants using Cloudflare Workers Static Assets and Supabase. Each merchant can sign up, sign in, manage products and connect one Telegram bot. Once connected, the bot responds to /start with a setup message. Products are not yet displayed in Telegram.

## Before you begin

You need a Supabase project, a Cloudflare account, Node.js, and a Telegram bot created using @BotFather. The Supabase CLI can be run via npx. These services may have usage limits and charges; review their current plans. Use a test bot: connecting changes that bot's current webhook. Email confirmation may be enabled by default; use the link in the confirmation email before signing in.

This is starter code, not an audited production service. Test with two separate merchant accounts before sharing. Orders, payment, CSV, FAQ, bot disconnect/reconnect, recovery and customer shopping are not implemented. The /start response has no retry deduplication; temporary failures may result in repeated welcome messages. The bot connection flow is not transactional across the database and Telegram: on a network failure after saving configuration, an administrator may need to repair or delete the bot configuration before trying again. Do not use this starter for customer data until security review and operational testing are completed.

## 1. Set up Supabase

1. Create a Supabase project and keep its project reference, project URL and publishable (or legacy anon) key. The dashboard asks for the URL and public key in your browser.
2. In PowerShell, open this project directory. Run `npx supabase login`, then `npx supabase link --project-ref YOUR_PROJECT_REFERENCE`. Do not paste credentials into AI Studio or chat.
3. Run `npx supabase db push` to apply the migration. It creates products, bots, server-only bot secrets and row-level-security policies. Inspect these policies in Supabase before adding other tables.
4. Generate a random AES key locally. This prints a secret: keep it private and do not share its output:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

5. In Supabase Dashboard > Edge Functions > Secrets, add `BOT_ENCRYPTION_KEY` with that generated value. Do not rotate or delete this key without a migration plan: doing so makes stored bot tokens unreadable. The hosted Supabase functions also require their default `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` environment variables. The service-role key must never be put in the frontend.
6. Deploy using `npx supabase functions deploy connect-bot` and `npx supabase functions deploy telegram-webhook`. The project config disables gateway JWT verification for both; connect-bot validates the user's access token itself, while telegram-webhook checks Telegram's per-bot secret header. Do not remove those checks.

## 2. Run the frontend locally

Run `npx --yes http-server public -p 8080 -c-1` from this directory, then open http://localhost:8080. On first use enter your Supabase URL and publishable key. Create an account or sign in. Your password is processed by Supabase Auth. The dashboard uses a public CDN to load supabase-js, so the browser needs internet access.

## 3. Deploy the frontend to Cloudflare

From the project directory run `npx wrangler login` and then `npx wrangler deploy`. The included wrangler.toml publishes the static public directory as a Cloudflare Worker. Alternatively, import the repository into Cloudflare Workers, using `public` as the static assets directory. Review the Cloudflare deployment and access settings before sharing the URL.

## 4. Verify

- Register two test merchant accounts and confirm each can see and change only its own products.
- Add, edit and delete a sample product; reload and check data persists.
- Sign in as each merchant and connect a different test bot. Never share your token in chat. Send /start to each bot and look for a welcome message.
- A bad token must fail. A request to the webhook without the Telegram secret header must return 401 for a known bot.
- The browser must never receive the service-role key, encryption key, saved bot token, or webhook secret. `bot_secrets` has no client-access policy.

## Architecture and security notes

- The React-free frontend uses browser modules, Supabase Auth and public-key access controlled by RLS. All product ownership is `auth.uid()`.
- A Supabase Edge Function checks the caller's identity, validates the token with Telegram, encrypts it with AES-GCM using the server secret, and registers a unique webhook secret. The webhook looks up the bot by non-secret ID, checks the Telegram secret header, decrypts the token server-side and responds.
- Telegram tokens are powerful credentials. Limit access to Supabase administrators, functions, and logs. Do not use production tokens until the application has been reviewed. Revoke a leaked token with BotFather. Changing the encryption key without re-encrypting tokens will break bots.
- Currency amounts are integers in the currency's smallest unit. Confirm currency-specific formatting before adding checkout. There is no automatic payment integration.

## Google AI Studio workflow

You can use AI Studio Build mode to iterate on the frontend: import or copy the code, ask for one bounded change at a time, export the project, then review differences and test before deployment. Keep the backend functions and migrations in the exported project and never paste secrets into prompts. AI Studio's preview hosting is not identical to Cloudflare: avoid relying on its Node server for this static frontend.
