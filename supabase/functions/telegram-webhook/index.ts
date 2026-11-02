import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const decodeBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const url = new URL(req.url);
    const botId = url.searchParams.get("bot");

    if (!botId || !/^\d{5,20}$/.test(botId)) {
      return new Response("Invalid request", { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const encryptionKey64 = Deno.env.get("BOT_ENCRYPTION_KEY");

    if (!supabaseUrl || !serviceRoleKey || !encryptionKey64) {
      console.error("[telegram-webhook] Missing required environment variables.");
      return new Response("Server configuration error", { status: 503 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // 1. Look up bot by public Telegram bot id
    const { data: bot, error: botError } = await admin
      .from("bots")
      .select("merchant_id")
      .eq("telegram_bot_id", botId)
      .maybeSingle();

    if (botError) {
      console.error("[telegram-webhook] Database lookup error:", botError);
      return new Response("Temporary error", { status: 503 });
    }

    if (!bot) {
      return new Response("Bot not found", { status: 404 });
    }

    // 2. Fetch encrypted secret credentials
    const { data: secrets, error: secretsError } = await admin
      .from("bot_secrets")
      .select("token_ciphertext, token_iv, webhook_secret")
      .eq("merchant_id", bot.merchant_id)
      .maybeSingle();

    if (secretsError || !secrets) {
      console.error("[telegram-webhook] Secrets lookup error:", secretsError);
      return new Response("Temporary error", { status: 503 });
    }

    // 3. Verify Telegram secret header
    const incomingSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (incomingSecret !== secrets.webhook_secret) {
      console.warn("[telegram-webhook] Unauthorized: secret token mismatch.");
      return new Response("Unauthorized", { status: 401 });
    }

    // 4. Parse Telegram update
    const update = await req.json();
    const message = update?.message;
    const text = message?.text;
    const chatId = message?.chat?.id;

    // For non-start messages in Milestone 1, acknowledge with 200 OK
    if (typeof text !== "string" || !chatId || !/^\/start(?:\s|$)/.test(text)) {
      return new Response("ok", { status: 200 });
    }

    // 5. Decrypt bot token server-side using AES-GCM
    const rawKey = decodeBase64(encryptionKey64);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      rawKey,
      "AES-GCM",
      false,
      ["decrypt"]
    );

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64(secrets.token_iv) },
      cryptoKey,
      decodeBase64(secrets.token_ciphertext)
    );

    const decryptedToken = new TextDecoder().decode(decryptedBuffer);

    // 6. Send welcome message back to customer
    const tgResponse = await fetch(`https://api.telegram.org/bot${decryptedToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "👋 Welcome to this shop!\n\nThe merchant is currently configuring the store catalog. Shopping and order placement will be available soon.",
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!tgResponse.ok) {
      const errBody = await tgResponse.text();
      console.error("[telegram-webhook] Telegram sendMessage failed:", tgResponse.status, errBody);
      return new Response("Temporary error", { status: 503 });
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[telegram-webhook] Unhandled exception:", err);
    return new Response("Temporary error", { status: 503 });
  }
});
