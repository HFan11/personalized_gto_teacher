-- supabase/user-settings-table.sql
-- Private per-user settings store.
--
-- The previous migration (profile-settings.sql) added a `settings`
-- JSONB column to `profiles`, but that table has a legacy policy
-- "Profiles readable by all FOR SELECT USING (true)" (from the
-- original schema.sql, needed so the leaderboard + social features
-- can see everyone's display_name/bankroll). That made `settings`
-- world-readable too, leaking edited ranges across accounts.
--
-- Fix: put settings in a dedicated table with strict "own row only"
-- RLS. The old profiles.settings column is left in place as dead
-- data so rolling back doesn't lose anything, but no code reads it
-- anymore.

CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id     UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    settings    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies with same name (idempotent re-run safety)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_settings' AND policyname='user_settings_select_own') THEN
        DROP POLICY user_settings_select_own ON public.user_settings;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_settings' AND policyname='user_settings_insert_own') THEN
        DROP POLICY user_settings_insert_own ON public.user_settings;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_settings' AND policyname='user_settings_update_own') THEN
        DROP POLICY user_settings_update_own ON public.user_settings;
    END IF;
END$$;

-- Each user can only see / write their own row. No public read at all.
CREATE POLICY user_settings_select_own ON public.user_settings
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY user_settings_insert_own ON public.user_settings
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_settings_update_own ON public.user_settings
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.user_settings TO authenticated;

-- One-time data migration: if a user has settings stuffed in the old
-- profiles.settings column (from the previous migration attempt), copy
-- it into user_settings on a first-come-first-served basis. Safe to
-- re-run; INSERT ... ON CONFLICT DO NOTHING.
INSERT INTO public.user_settings (user_id, settings, updated_at)
SELECT id, settings, COALESCE(updated_at, NOW())
FROM public.profiles
WHERE settings IS NOT NULL
  AND settings <> '{}'::jsonb
ON CONFLICT (user_id) DO NOTHING;
