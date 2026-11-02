import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const encodeBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Track database write stages for atomic rollback
  let botRowCreated = false;
  let secretRowCreated = false;
  let adminClient: ReturnType<typeof createClient> | null = null;
  let merchantId: string | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const key64 = Deno.env.get("BOT_ENCRYPTION_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error("[connect-bot] Missing required Supabase environment variables.");
      return json({ error: "Server configuration error: missing Supabase environment variables." }, 500);
    }

    if (!key64) {
      console.error("[connect-bot] BOT_ENCRYPTION_KEY secret is not set in Edge Functions.");
      return json({ error: "Bot encryption is not configured on the platform. Please notify the platform owner." }, 500);
    }

    // Decode and validate 32-byte AES-GCM key
    let keyBytes: Uint8Array;
    try {
      keyBytes = Uint8Array.from(atob(key64), (c) => c.charCodeAt(0));
      if (keyBytes.length !== 32) {
        throw new Error("Invalid key length");
      }
    } catch {
      console.error("[connect-bot] BOT_ENCRYPTION_KEY must be a valid base64-encoded 32-byte key.");
      return json({ error: "Invalid bot encryption key configuration on the server." }, 500);
    }

    // Authenticate the merchant from caller JWT
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) {
      return json({ error: "Missing authorization header. Please sign in." }, 401);
    }

    const scopedClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: authError } = await scopedClient.auth.getUser();
    if (authError || !user) {
      return json({ error: "Authentication failed. Please sign in again." }, 401);
    }

    merchantId = user.id;

    // Validate payload
    let payload: { token?: unknown };
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Invalid JSON request body." }, 400);
    }

    const token = typeof payload.token === "string" ? payload.token.trim() : "";
    if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) {
      return json({ error: "Invalid Telegram bot token format. Expected: 123456:ABC-DEF..." }, 400);
    }

    // Initialize privileged admin client for server-only operations
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Check if this merchant already has a connected bot
    const { data: existing, error: lookupError } = await adminClient
      .from("bots")
      .select("telegram_bot_id, username")
      .eq("merchant_id", merchantId)
      .maybeSingle();

    if (lookupError) {
      console.error("[connect-bot] Merchant lookup error:", lookupError);
      return json({ error: "Database lookup failed while checking existing bot." }, 500);
    }

    if (existing) {
      return json({
        error: `Your account is already connected to @${existing.username}. Disconnecting or switching bots is not supported in this version.`,
      }, 409);
    }

    // Verify token with Telegram API (with 10-second timeout)
    let tgMeResponse: Response;
    try {
      tgMeResponse = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(10000),
      });
    } catch (err: unknown) {
      console.error("[connect-bot] Telegram getMe network timeout/error:", err);
      return json({ error: "Failed to connect to Telegram API. Please check your network and try again." }, 504);
    }

    const me = await tgMeResponse.json();
    if (!tgMeResponse.ok || !me.ok || !me.result?.is_bot || !me.result?.username) {
      const reason = me?.description || "Telegram rejected this token. Verify that you copied it correctly from @BotFather.";
      return json({ error: reason }, 400);
    }

    const botId = me.result.id;
    const botUsername = me.result.username;

    // Encrypt the bot token using AES-GCM (256-bit)
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      "AES-GCM",
      false,
      ["encrypt"]
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const tokenBuffer = new TextEncoder().encode(token);
    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      tokenBuffer
    );

    // Generate random 32-byte URL-safe webhook secret
    const rawSecret = crypto.getRandomValues(new Uint8Array(32));
    const webhookSecret = encodeBase64(rawSecret)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");

    // Step 1: Insert bot metadata
    const { error: botError } = await adminClient.from("bots").insert({
      merchant_id: merchantId,
      telegram_bot_id: botId,
      username: botUsername,
    });

    if (botError) {
      console.error("[connect-bot] Error inserting bot row:", botError);
      return json({
        error: "This bot is already linked to another merchant, or your account already has a bot.",
      }, 409);
    }
    botRowCreated = true;

    // Step 2: Insert encrypted bot secrets
    const { error: secretError } = await adminClient.from("bot_secrets").insert({
      merchant_id: merchantId,
      token_ciphertext: encodeBase64(new Uint8Array(encryptedBuffer)),
      token_iv: encodeBase64(iv),
      webhook_secret: webhookSecret,
    });

    if (secretError) {
      console.error("[connect-bot] Error saving bot secret, rolling back bot row:", secretError);
      await adminClient.from("bots").delete().eq("merchant_id", merchantId);
      return json({ error: "Failed to store encrypted bot configuration in database." }, 500);
    }
    secretRowCreated = true;

    // Step 3: Register Webhook with Telegram (with 10-second timeout)
    const webhookUrl = `${supabaseUrl}/functions/v1/telegram-webhook?bot=${botId}`;
    let setWhResponse: Response;

    try {
      setWhResponse = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: webhookSecret,
          allowed_updates: ["message"],
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (whNetworkError: unknown) {
      console.error("[connect-bot] Network failure calling Telegram setWebhook:", whNetworkError);
      // Initiate automatic rollback
      await rollbackDatabaseRecords(adminClient, merchantId);
      return json({
        error: "Telegram webhook setup timed out or failed to reach Telegram. Database changes were safely rolled back. Please try again.",
      }, 504);
    }

    const whResult = await setWhResponse.json();
    if (!setWhResponse.ok || !whResult.ok) {
      const desc = whResult?.description || "Telegram rejected the webhook URL.";
      console.error("[connect-bot] Telegram setWebhook returned error:", whResult);
      // Initiate automatic rollback
      await rollbackDatabaseRecords(adminClient, merchantId);
      return json({
        error: `Telegram could not configure webhook: ${desc}. Database changes were safely rolled back.`,
      }, 502);
    }

    // Success! Return only public username
    return json({
      ok: true,
      username: botUsername,
    });
  } catch (unexpectedError) {
    console.error("[connect-bot] Unexpected server exception:", unexpectedError);

    // If records were created before unexpected crash, attempt rollback
    if (adminClient && merchantId && (botRowCreated || secretRowCreated)) {
      await rollbackDatabaseRecords(adminClient, merchantId);
    }

    return json({
      error: "An unexpected error occurred while connecting the bot. Check Edge Function logs for details.",
    }, 500);
  }
});

/**
 * Safely removes partially configured bot and secrets rows if webhook registration fails.
 */
async function rollbackDatabaseRecords(admin: ReturnType<typeof createClient>, merchantId: string) {
  try {
    // Explicitly delete both to ensure clean state regardless of foreign key cascade timing
    await admin.from("bot_secrets").delete().eq("merchant_id", merchantId);
    await admin.from("bots").delete().eq("merchant_id", merchantId);
    console.info(`[connect-bot] Successfully rolled back database records for merchant: ${merchantId}`);
  } catch (rollbackErr) {
    console.error(`[connect-bot] CRITICAL: Failed to rollback orphaned bot record for merchant ${merchantId}:`, rollbackErr);
  }
}
