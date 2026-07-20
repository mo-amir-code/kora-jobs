import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}

if (!supabaseSecretKey) {
  throw new Error('Missing required environment variable: SUPABASE_SECRET_KEY');
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseSecretKey);
