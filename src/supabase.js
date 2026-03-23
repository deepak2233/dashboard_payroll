import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://kdusmhhjyanjoxsvyxmr.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkdXNtaGhqeWFuam94c3Z5eG1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNjY1MzQsImV4cCI6MjA4OTg0MjUzNH0.1mwzRMpDIj3khtyC1eeFJvK4suZQxAWNlW0J_JZ-18M'

export const isSupabaseConfigured = true

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
