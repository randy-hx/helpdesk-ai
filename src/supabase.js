import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Captured BEFORE the client reads (and clears) the link, so the app knows
// the user arrived from a "reset password" email.
export const isRecoveryLink = typeof window !== 'undefined' && (window.location.hash || '').indexOf('type=recovery') >= 0

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
})
