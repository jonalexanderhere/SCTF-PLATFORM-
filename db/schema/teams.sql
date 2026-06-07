-- ==============================================
-- Table: teams
-- ==============================================

CREATE TABLE IF NOT EXISTS public.teams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  secret_key TEXT UNIQUE NOT NULL,
  access_token TEXT UNIQUE NOT NULL,
  captain_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  deactivation_message TEXT DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
