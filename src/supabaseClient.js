import { createClient } from '@supabase/supabase-js';

// URL otomatis dari Project ID kamu
const supabaseUrl = 'https://mylhupckzmxwnnghawwm.supabase.co'; 

// Anonkey publik asli milikmu yang sangat panjang
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15bGh1cGNrem14d25uZ2hhd3dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMTk3NjMsImV4cCI6MjA5NTg5NTc2M30.AZJcqOfUiADohKecQQsiRpL-NCMDZBWggQrsTsuHaTI'; 

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
