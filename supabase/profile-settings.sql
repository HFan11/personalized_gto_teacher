-- supabase/profile-settings.sql
-- Per-user persistence for the training-page state: edited profiles
-- (ranges, custom bots) + currently-selected hero/villain IDs.
--
-- Before: stored in localStorage['poker_profiles'] — browser-local,
-- so a user who edits ranges on Device A sees nothing on Device B,
-- and a shared computer leaks one user's edits to the next.
--
-- After: a JSONB column on the existing `profiles` table. Shape:
--   {
--     "profiles":        [ ...full ProfileManager.profiles array... ],
--     "selectedHeroId":  "gto-balanced"  | "custom-1776…" | null,
--     "selectedVillainId": "tight-nit"   | …              | null,
--     "v": 1
--   }
-- Client merges: on login, if row has non-empty settings, they
-- overwrite local. On every profile edit, client debounced-pushes
-- the new blob up.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- RLS: allow each user to read/update their own row's settings.
-- The `profiles` table should already have RLS enabled with a
-- "users can read/update own row" policy from the original auth
-- setup; if not, the blocks below add it idempotently.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'profiles'
          AND policyname = 'profiles_select_own'
    ) THEN
        CREATE POLICY profiles_select_own ON public.profiles
            FOR SELECT USING (auth.uid() = id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'profiles'
          AND policyname = 'profiles_update_own'
    ) THEN
        CREATE POLICY profiles_update_own ON public.profiles
            FOR UPDATE USING (auth.uid() = id)
            WITH CHECK (auth.uid() = id);
    END IF;
END$$;
