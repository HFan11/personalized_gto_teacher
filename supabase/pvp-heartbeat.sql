-- ============================================================
-- PVP Heartbeat + Auto-Reset
-- Run in Supabase SQL Editor
-- ============================================================
-- Each human client calls pvp_heartbeat() every ~5s to prove liveness.
-- Host = lowest-seat human with last_seen < 10s ago.
-- When no humans are active AND room is mid-hand → any joining client
-- triggers pvp_reset_game() to return room to clean 'waiting' state.
-- ============================================================

-- Heartbeat: update caller's seat.last_seen timestamp
-- Does NOT modify updated_at (to avoid triggering every client's re-render)
CREATE OR REPLACE FUNCTION public.pvp_heartbeat()
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_seats JSONB;
    v_now REAL := extract(epoch from now());
    i INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RETURN '{"error":"not authenticated"}'::jsonb; END IF;

    SELECT seats INTO v_seats FROM pvp_room WHERE id = 1 FOR UPDATE;
    FOR i IN 0..5 LOOP
        IF (v_seats->i->>'user_id') = v_user_id::text THEN
            v_seats := jsonb_set(v_seats, ARRAY[i::text, 'last_seen'], to_jsonb(v_now));
            -- Write seats but leave updated_at alone (heartbeat shouldn't trigger re-render)
            UPDATE pvp_room SET seats = v_seats WHERE id = 1;
            RETURN jsonb_build_object('ok', true, 'seat', i, 'ts', v_now);
        END IF;
    END LOOP;
    RETURN '{"error":"not in room"}'::jsonb;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reset game state (keeps seat assignments, clears game progress)
-- Called when room is orphaned (mid-hand with no active humans)
CREATE OR REPLACE FUNCTION public.pvp_reset_game()
RETURNS JSONB AS $$
BEGIN
    UPDATE pvp_room SET
        street = 'waiting',
        pot = 0,
        current_bet = 0,
        bets = '{0,0,0,0,0,0}',
        folded = '{f,f,f,f,f,f}',
        all_in = '{f,f,f,f,f,f}',
        board = '{}',
        deck = '{}',
        acting_seat = -1,
        last_action = '{}',
        updated_at = NOW()
    WHERE id = 1;
    DELETE FROM pvp_hands WHERE room_id = 1;
    RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Modified pvp_join: set last_seen on join so new player immediately counts as active
CREATE OR REPLACE FUNCTION public.pvp_join(p_seat INTEGER)
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_seats JSONB;
    v_user_id UUID := auth.uid();
    v_name TEXT;
    v_seat JSONB;
    v_now REAL := extract(epoch from now());
    v_any_active BOOLEAN := false;
    v_last_seen REAL;
    i INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RETURN '{"error":"not authenticated"}'::jsonb; END IF;

    SELECT display_name INTO v_name FROM profiles WHERE id = v_user_id;
    IF v_name IS NULL THEN v_name := 'Player'; END IF;

    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;
    v_seats := v_room.seats;

    -- Initialize 6 bot seats if empty
    IF jsonb_array_length(v_seats) < 6 THEN
        v_seats := '[]'::jsonb;
        FOR i IN 0..5 LOOP
            v_seats := v_seats || jsonb_build_object(
                'user_id', NULL, 'name', 'Bot ' || (i+1), 'stack', 100,
                'seat_idx', i, 'is_bot', true
            );
        END LOOP;
    END IF;

    -- Check if already seated
    FOR i IN 0..5 LOOP
        v_seat := v_seats->i;
        IF v_seat->>'user_id' = v_user_id::text THEN
            -- Update last_seen to now so we're marked active
            v_seats := jsonb_set(v_seats, ARRAY[i::text, 'last_seen'], to_jsonb(v_now));
            UPDATE pvp_room SET seats = v_seats, updated_at = NOW() WHERE id = 1;
            RETURN jsonb_build_object('ok', true, 'seat', i, 'msg', 'already seated');
        END IF;
    END LOOP;

    -- Check seat available (must be bot)
    v_seat := v_seats->p_seat;
    IF v_seat IS NULL OR (v_seat->>'is_bot')::boolean IS NOT TRUE THEN
        RETURN '{"error":"seat taken"}'::jsonb;
    END IF;

    -- Check if any existing human is still active (last_seen within 10s)
    FOR i IN 0..5 LOOP
        v_seat := v_seats->i;
        IF NOT (v_seat->>'is_bot')::boolean THEN
            v_last_seen := COALESCE((v_seat->>'last_seen')::real, 0);
            IF v_now - v_last_seen < 10 THEN
                v_any_active := true;
                EXIT;
            END IF;
        END IF;
    END LOOP;

    -- If no active humans AND room is mid-hand → reset to clean state
    IF NOT v_any_active AND v_room.street != 'waiting' THEN
        UPDATE pvp_room SET
            street = 'waiting', pot = 0, current_bet = 0,
            bets = '{0,0,0,0,0,0}', folded = '{f,f,f,f,f,f}',
            all_in = '{f,f,f,f,f,f}', board = '{}', deck = '{}',
            acting_seat = -1, last_action = '{}'
        WHERE id = 1;
        DELETE FROM pvp_hands WHERE room_id = 1;
    END IF;

    -- Replace bot with player (set last_seen)
    v_seats := jsonb_set(v_seats, ARRAY[p_seat::text], jsonb_build_object(
        'user_id', v_user_id, 'name', v_name, 'stack', 100,
        'seat_idx', p_seat, 'is_bot', false, 'last_seen', v_now
    ));

    UPDATE pvp_room SET seats = v_seats, updated_at = NOW() WHERE id = 1;
    RETURN jsonb_build_object('ok', true, 'seat', p_seat);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.pvp_heartbeat() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_reset_game() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_join(INTEGER) TO authenticated;
