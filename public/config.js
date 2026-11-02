// TeleShop Platform Configuration
// As the platform owner, set your shared Supabase project credentials below.
// All merchants will connect to this Supabase instance.
//
// SECURITY WARNING:
// NEVER put your Supabase service-role (secret) key, database password, or bot encryption key here.
// Only use the public/publishable (anon) key.

export const platformConfig = {
  // Replace with your Supabase Project URL (e.g. "https://abcdefghijklmnopqrst.supabase.co")
  supabaseUrl: "https://your-project.supabase.co",

  // Replace with your Supabase Publishable / Anon Key (starts with "sb_publishable_" or "ey...")
  supabaseAnonKey: "your-publishable-key-here"
};

/**
 * Validates whether the platform configuration has been set by the owner.
 * Returns true if valid, false if default placeholders are still present.
 */
export function isConfigured() {
  const url = platformConfig.supabaseUrl?.trim();
  const key = platformConfig.supabaseAnonKey?.trim();

  if (!url || !key) return false;
  if (url.includes("your-project.supabase.co")) return false;
  if (key === "your-publishable-key-here" || key.length < 10) return false;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

