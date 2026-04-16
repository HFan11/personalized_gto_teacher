-- ============================================================
-- Supabase Database Schema for PokerGTO
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- User profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    bankroll INTEGER DEFAULT 1000,       -- casino chips
    bankroll_day_start INTEGER DEFAULT 1000, -- bankroll at start of day (for daily P&L)
    last_checkin DATE,                    -- daily check-in date
    last_day_reset DATE,                  -- last day bankroll_day_start was set
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Practice stats per user
CREATE TABLE IF NOT EXISTS public.practice_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,                   -- 'preflop', 'postflop', 'cashgame'
    hands_played INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0,        -- sum of scores (for average)
    profit_bb REAL DEFAULT 0,            -- cash game BB won/lost
    best_streak INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, mode)
);

-- Cash game session history
CREATE TABLE IF NOT EXISTS public.game_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,                   -- 'cashgame', 'roulette', 'slots'
    hands_played INTEGER DEFAULT 0,
    profit REAL DEFAULT 0,
    buy_in REAL DEFAULT 100,
    duration_seconds INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leaderboard view (top players by profit)
CREATE OR REPLACE VIEW public.leaderboard AS
SELECT
    p.id,
    p.username,
    p.display_name,
    p.bankroll,
    COALESCE(SUM(CASE WHEN s.mode = 'cashgame' THEN s.hands_played END), 0) AS cash_hands,
    COALESCE(SUM(CASE WHEN s.mode = 'cashgame' THEN s.profit_bb END), 0) AS cash_profit,
    COALESCE(SUM(CASE WHEN s.mode = 'preflop' THEN s.total_score END), 0) /
        NULLIF(COALESCE(SUM(CASE WHEN s.mode = 'preflop' THEN s.hands_played END), 0), 0) AS preflop_avg_score,
    COALESCE(SUM(CASE WHEN s.mode = 'postflop' THEN s.total_score END), 0) /
        NULLIF(COALESCE(SUM(CASE WHEN s.mode = 'postflop' THEN s.hands_played END), 0), 0) AS postflop_avg_score
FROM public.profiles p
LEFT JOIN public.practice_stats s ON s.user_id = p.id
GROUP BY p.id, p.username, p.display_name, p.bankroll
ORDER BY cash_profit DESC;

-- Auto-create profile when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, username, display_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: auto-create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all, update own
CREATE POLICY "Profiles readable by all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Practice stats: users can read/write own
CREATE POLICY "Users can read own stats" ON public.practice_stats FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own stats" ON public.practice_stats FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own stats" ON public.practice_stats FOR UPDATE USING (auth.uid() = user_id);

-- Game sessions: users can read/write own
CREATE POLICY "Users can read own sessions" ON public.game_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sessions" ON public.game_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Leaderboard: readable by all (it's a view, inherits from profiles)
GRANT SELECT ON public.leaderboard TO anon, authenticated;
