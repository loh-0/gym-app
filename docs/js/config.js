import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';

// ============================================================
// SUPABASE CONFIG — paste your project values here
// ============================================================
export const SUPABASE_URL = 'https://tverznmarwwzcvoyudrb.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Hg2CllEdPWmDEt8UUHaLpg_-J_DDYuI';

function makeClient() {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.startsWith('YOUR_') || SUPABASE_ANON_KEY.startsWith('YOUR_')) {
      throw new Error('Supabase is not configured yet.');
    }
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    console.warn(err);
    return null;
  }
}

export const supabase = makeClient();
