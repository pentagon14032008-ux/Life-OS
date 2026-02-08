import { CONFIG } from "../config.js";

// Using esm.sh for browser ESM (workaround for some jsDelivr +esm issues)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function makeSupabase() {
  if (!CONFIG.SUPABASE_URL.startsWith("http")) {
    throw new Error("Supabase URL not configured. Edit src/config.js");
  }
  return createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}