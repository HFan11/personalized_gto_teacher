-- pvp-v7-hotfix2.sql
-- Fix: pvp_bot_action's 150ms throttle never fires because
-- pvp_do_action's `UPDATE pvp_room SET last_action = jsonb_build_object(...)`
-- replaces last_action wholesale, wiping the `bot_ts` field that the
-- throttle wrote moments earlier. The next call reads bot_ts=0 and
-- always passes the cooldown check.
--
-- Fix: write `bot_ts` AFTER pvp_do_action returns, merging into the
-- updated last_action so the next call sees a non-zero timestamp.

CREATE OR REPLACE FUNCTION public.pvp_bot_action(p_action TEXT, p_amount REAL DEFAULT 0)
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_seat_idx INTEGER;
    v_seat JSONB;
    v_is_bot BOOLEAN;
    v_now DOUBLE PRECISION := extract(epoch from now());
    v_last_bot_ts DOUBLE PRECISION;
    v_result JSONB;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;

    -- Throttle: at most one bot action per 150ms
    v_last_bot_ts := COALESCE((v_room.last_action->>'bot_ts')::double precision, 0);
    IF v_now - v_last_bot_ts < 0.15 THEN
        RETURN '{"error":"too fast"}'::jsonb;
    END IF;

    v_seat_idx := v_room.acting_seat;
    IF v_seat_idx < 0 OR v_seat_idx > 5 THEN
        RETURN '{"error":"no acting seat"}'::jsonb;
    END IF;

    v_seat := v_room.seats->v_seat_idx;
    v_is_bot := COALESCE((v_seat->>'is_bot')::boolean, false) OR (v_seat->>'user_id') IS NULL;
    IF NOT v_is_bot THEN
        RETURN '{"error":"not a bot seat"}'::jsonb;
    END IF;

    -- Delegate to pvp_do_action FIRST (it overwrites last_action)
    v_result := pvp_do_action(v_seat_idx, p_action, p_amount);

    -- Now merge bot_ts into the freshly-written last_action so the
    -- NEXT pvp_bot_action call's throttle check actually sees it.
    UPDATE pvp_room
    SET last_action = COALESCE(last_action, '{}'::jsonb) || jsonb_build_object('bot_ts', v_now)
    WHERE id = 1;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.pvp_bot_action(TEXT, REAL) TO authenticated;
