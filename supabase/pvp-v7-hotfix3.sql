-- pvp-v7-hotfix3.sql
-- CRITICAL: pvp_sit_seat / pvp_heartbeat declared `v_now REAL`, but a unix
-- epoch (~1.776e9) overflows float32 precision (~7 digits). The value
-- gets truncated to the nearest ~100s, so when pvp_deal (which uses
-- DOUBLE PRECISION) compares `v_now - last_seen` it can see deltas of
-- hundreds of seconds even for a player who *just* sat down.
--
-- Symptom: every fresh sit gets stale-kicked on the very next deal,
-- regardless of the 60s threshold. Diagnosed by reading back last_seen
-- right after sit_seat → showed "2959s ago" for a 0.1s-old timestamp.
--
-- Fix: change v_now to DOUBLE PRECISION in every function that writes
-- last_seen (sit_seat, heartbeat). Latent since v3 — masked when
-- threshold was 15s because the truncation error sometimes happened to
-- fall inside the window. Bumping to 60s in v7 made it surface
-- consistently for me; users probably hit it too.

-- ============================================================
-- pvp_sit_seat: REAL → DOUBLE PRECISION for v_now
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_sit_seat(p_seat INTEGER)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_room pvp_room%ROWTYPE;
    v_seats JSONB;
    v_seat JSONB;
    v_name TEXT;
    v_now DOUBLE PRECISION := extract(epoch from now());   -- was REAL
    v_bankroll INTEGER;
    v_buy_in INTEGER := 100;
    v_changes JSONB;
    v_new_changes JSONB := '[]'::jsonb;
    v_change JSONB;
    i INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RETURN '{"error":"not authenticated"}'::jsonb; END IF;
    IF p_seat < 0 OR p_seat > 5 THEN RETURN '{"error":"invalid seat"}'::jsonb; END IF;

    SELECT display_name, bankroll INTO v_name, v_bankroll FROM profiles WHERE id = v_user_id;
    IF v_name IS NULL THEN v_name := 'Player'; END IF;
    IF v_bankroll IS NULL OR v_bankroll < v_buy_in THEN
        RETURN jsonb_build_object('error', '余额不足，需要 ' || v_buy_in || ' 筹码');
    END IF;

    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;
    v_seats := v_room.seats;
    v_changes := COALESCE(v_room.pending_changes, '[]'::jsonb);

    IF jsonb_array_length(v_seats) < 6 THEN
        v_seats := '[]'::jsonb;
        FOR i IN 0..5 LOOP
            v_seats := v_seats || jsonb_build_object(
                'user_id', NULL, 'name', 'Bot ' || (i+1), 'stack', 100,
                'seat_idx', i, 'type', 'bot', 'is_bot', true
            );
        END LOOP;
        UPDATE pvp_room SET seats = v_seats WHERE id = 1;
    END IF;

    FOR i IN 0..5 LOOP
        IF (v_seats->i->>'user_id') = v_user_id::text THEN
            -- Already seated — refresh last_seen so subsequent stale check passes
            v_seats := jsonb_set(v_seats, ARRAY[i::text, 'last_seen'], to_jsonb(v_now));
            UPDATE pvp_room SET seats = v_seats, updated_at = NOW() WHERE id = 1;
            RETURN jsonb_build_object('ok', true, 'msg', 'already seated', 'seat', i);
        END IF;
    END LOOP;

    FOR i IN 0..jsonb_array_length(v_changes)-1 LOOP
        v_change := v_changes->i;
        IF (v_change->>'user_id') = v_user_id::text AND (v_change->>'action') = 'sit' THEN
            RETURN jsonb_build_object('error', '你已请求入座', 'queued_seat', (v_change->>'seat')::int);
        END IF;
    END LOOP;

    v_seat := v_seats->p_seat;
    IF v_seat IS NULL OR (v_seat->>'type') = 'human' THEN
        RETURN '{"error":"seat taken"}'::jsonb;
    END IF;

    FOR i IN 0..jsonb_array_length(v_changes)-1 LOOP
        v_change := v_changes->i;
        IF (v_change->>'action') = 'sit' AND (v_change->>'seat')::int = p_seat THEN
            RETURN '{"error":"seat reserved"}'::jsonb;
        END IF;
    END LOOP;

    UPDATE profiles SET bankroll = bankroll - v_buy_in, updated_at = NOW() WHERE id = v_user_id;

    IF v_room.street = 'waiting' THEN
        v_seats := jsonb_set(v_seats, ARRAY[p_seat::text], jsonb_build_object(
            'user_id', v_user_id,
            'name', v_name,
            'stack', v_buy_in::real,
            'seat_idx', p_seat,
            'type', 'human',
            'is_bot', false,
            'last_seen', v_now
        ));
        UPDATE pvp_room SET seats = v_seats, updated_at = NOW() WHERE id = 1;
        RETURN jsonb_build_object('ok', true, 'seat', p_seat, 'immediate', true);
    ELSE
        v_new_changes := v_changes || jsonb_build_object(
            'action', 'sit',
            'seat', p_seat,
            'user_id', v_user_id,
            'name', v_name,
            'stack', v_buy_in,
            'ts', v_now
        );
        UPDATE pvp_room SET pending_changes = v_new_changes, updated_at = NOW() WHERE id = 1;
        RETURN jsonb_build_object('ok', true, 'seat', p_seat, 'queued', true);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.pvp_sit_seat(INTEGER) TO authenticated;

-- ============================================================
-- pvp_heartbeat: REAL → DOUBLE PRECISION for v_now
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_heartbeat()
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_seats JSONB;
    v_now DOUBLE PRECISION := extract(epoch from now());   -- was REAL
    i INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RETURN '{"error":"not authenticated"}'::jsonb; END IF;

    SELECT seats INTO v_seats FROM pvp_room WHERE id = 1 FOR UPDATE;
    FOR i IN 0..5 LOOP
        IF (v_seats->i->>'user_id') = v_user_id::text THEN
            v_seats := jsonb_set(v_seats, ARRAY[i::text, 'last_seen'], to_jsonb(v_now));
            UPDATE pvp_room SET seats = v_seats WHERE id = 1;
            RETURN jsonb_build_object('ok', true, 'seat', i, 'ts', v_now);
        END IF;
    END LOOP;
    RETURN '{"error":"not in room"}'::jsonb;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.pvp_heartbeat() TO authenticated;
