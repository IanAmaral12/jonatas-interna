import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublicKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigError =
  'Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no arquivo .env para conectar ao Supabase.'

export const supabase = supabaseUrl && supabasePublicKey
  ? createClient(supabaseUrl, supabasePublicKey)
  : null
