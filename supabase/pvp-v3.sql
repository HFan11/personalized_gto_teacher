-- ============================================================
-- PVP v3: Spectator-first + Human/Bot Mixed + No Host Model
-- Run ENTIRE file in Supabase SQL Editor
-- ============================================================

-- Schema: add pending_changes column
ALTER TABLE public.pvp_room ADD COLUMN IF NOT EXISTS pending_changes JSONB DEFAULT '[]'::jsonb;

-- Ensure each seat has a 'type' field (backfill for existing rows)
UPDATE public.pvp_room SET seats = (
    SELECT jsonb_agg(
        s || jsonb_build_object('type', CASE WHEN (s->>'is_bot')::boolean IS TRUE OR s->>'user_id' IS NULL THEN 'bot' ELSE 'human' END)
    )
    FROM jsonb_array_elements(seats) s
) WHERE id = 1;

-- ============================================================
-- pvp_sit_seat: request to sit at bot seat
--   - If street='waiting': immediate sit (deduct 100 bankroll)
--   - Otherwise: queue as pending change, deduct 100 now
--   - User can only hold ONE pending sit at a time
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_sit_seat(p_seat INTEGER)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_room pvp_room%ROWTYPE;
    v_seats JSONB;
    v_seat JSONB;
    v_name TEXT;
    v_now REAL := extract(epoch from now());
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

    -- Init 6 bot seats if needed
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

    -- Check: user already seated?
    FOR i IN 0..5 LOOP
        IF (v_seats->i->>'user_id') = v_user_id::text THEN
            RETURN jsonb_build_object('ok', true, 'msg', 'already seated', 'seat', i);
        END IF;
    END LOOP;

    -- Check: user has a pending sit?
    FOR i IN 0..jsonb_array_length(v_changes)-1 LOOP
        v_change := v_changes->i;
        IF (v_change->>'user_id') = v_user_id::text AND (v_change->>'action') = 'sit' THEN
            RETURN jsonb_build_object('error', '你已请求入座', 'queued_seat', (v_change->>'seat')::int);
        END IF;
    END LOOP;

    -- Check: target seat is a bot?
    v_seat := v_seats->p_seat;
    IF v_seat IS NULL OR (v_seat->>'type') = 'human' THEN
        RETURN '{"error":"seat taken"}'::jsonb;
    END IF;
    -- Target seat pending-sit by someone else?
    FOR i IN 0..jsonb_array_length(v_changes)-1 LOOP
        v_change := v_changes->i;
        IF (v_change->>'action') = 'sit' AND (v_change->>'seat')::int = p_seat THEN
            RETURN '{"error":"seat reserved"}'::jsonb;
        END IF;
    END LOOP;

    -- Deduct buy-in from bankroll NOW (reserved for the sit)
    UPDATE profiles SET bankroll = bankroll - v_buy_in, updated_at = NOW() WHERE id = v_user_id;

    IF v_room.street = 'waiting' THEN
        -- Immediate: replace bot with human
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
        -- Queue for next hand
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

-- ============================================================
-- pvp_leave_seat: request to leave
--   - If street='waiting' or user folded: leave immediately (return stack)
--   - Otherwise: queue; user's seat becomes bot on next hand (stack returns)
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_leave_seat()
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_room pvp_room%ROWTYPE;
    v_seats JSONB;
    v_seat JSONB;
    v_seat_idx INTEGER := -1;
    v_stack REAL;
    v_changes JSONB;
    v_new_changes JSONB := '[]'::jsonb;
    v_change JSONB;
    i INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RETURN '{"error":"not authenticated"}'::jsonb; END IF;
    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;
    v_seats := v_room.seats;
    v_changes := COALESCE(v_room.pending_changes, '[]'::jsonb);

    -- Cancel any pending sit for this user (refund buy-in)
    FOR i IN 0..jsonb_array_length(v_changes)-1 LOOP
        v_change := v_changes->i;
        IF (v_change->>'user_id') = v_user_id::text AND (v_change->>'action') = 'sit' THEN
            -- Refund the reserved buy-in
            UPDATE profiles SET bankroll = bankroll + (v_change->>'stack')::int, updated_at = NOW()
            WHERE id = v_user_id;
        ELSE
            v_new_changes := v_new_changes || v_change;
        END IF;
    END LOOP;
    v_changes := v_new_changes;

    -- Find user's seat
    FOR i IN 0..5 LOOP
        IF (v_seats->i->>'user_id') = v_user_id::text THEN
            v_seat_idx := i;
            EXIT;
        END IF;
    END LOOP;

    IF v_seat_idx < 0 THEN
        -- Not seated, just clear pending changes (refund already done)
        UPDATE pvp_room SET pending_changes = v_changes, updated_at = NOW() WHERE id = 1;
        RETURN jsonb_build_object('ok', true, 'msg', 'not seated');
    END IF;

    v_seat := v_seats->v_seat_idx;
    v_stack := (v_seat->>'stack')::real;

    -- Can leave immediately if hand not in progress OR user already folded
    IF v_room.street = 'waiting' OR v_room.folded[v_seat_idx+1] THEN
        -- Immediate leave: return stack, replace with bot
        IF v_stack > 0 THEN
            UPDATE profiles SET bankroll = bankroll + ROUND(v_stack)::int, updated_at = NOW()
            WHERE id = v_user_id;
        END IF;
        v_seats := jsonb_set(v_seats, ARRAY[v_seat_idx::text], jsonb_build_object(
            'user_id', NULL,
            'name', 'Bot ' || (v_seat_idx+1),
            'stack', 100::real,
            'seat_idx', v_seat_idx,
            'type', 'bot',
            'is_bot', true
        ));
        UPDATE pvp_room SET seats = v_seats, pending_changes = v_changes, updated_at = NOW() WHERE id = 1;
        RETURN jsonb_build_object('ok', true, 'immediate', true, 'returned', ROUND(v_stack));
    ELSE
        -- Queue leave (will be applied on next pvp_deal)
        v_changes := v_changes || jsonb_build_object(
            'action', 'leave',
            'seat', v_seat_idx,
            'user_id', v_user_id,
            'ts', extract(epoch from now())
        );
        UPDATE pvp_room SET pending_changes = v_changes, updated_at = NOW() WHERE id = 1;
        RETURN jsonb_build_object('ok', true, 'queued', true);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- pvp_deal: apply pending changes, kick stale humans, deal new hand
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_deal()
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_seats JSONB;
    v_changes JSONB;
    v_change JSONB;
    v_now REAL := extract(epoch from now());
    v_stale_threshold REAL := 15.0;
    v_hand_num INTEGER;
    v_deck TEXT[];
    v_folded BOOLEAN[];
    v_sb_seat INTEGER;
    v_bb_seat INTEGER;
    v_first_seat INTEGER;
    v_cards TEXT[];
    v_stack REAL;
    v_last_seen REAL;
    v_active_count INTEGER := 0;
    v_s JSONB;
    v_sidx INTEGER;
    v_leaving_stack REAL;
    i INTEGER;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;
    IF v_room.street != 'waiting' THEN
        RETURN '{"error":"hand in progress"}'::jsonb;
    END IF;

    v_seats := v_room.seats;
    v_changes := COALESCE(v_room.pending_changes, '[]'::jsonb);

    -- Init 6 bot seats if empty
    IF jsonb_array_length(v_seats) < 6 THEN
        v_seats := '[]'::jsonb;
        FOR i IN 0..5 LOOP
            v_seats := v_seats || jsonb_build_object(
                'user_id', NULL, 'name', 'Bot ' || (i+1), 'stack', 100,
                'seat_idx', i, 'type', 'bot', 'is_bot', true
            );
        END LOOP;
    END IF;

    -- === Apply pending_changes ===
    IF jsonb_array_length(v_changes) > 0 THEN
        FOR i IN 0..jsonb_array_length(v_changes)-1 LOOP
            v_change := v_changes->i;
            IF (v_change->>'action') = 'sit' THEN
                v_sidx := (v_change->>'seat')::int;
                -- Only apply if target seat is still a bot
                IF (v_seats->v_sidx->>'type') = 'bot' THEN
                    v_seats := jsonb_set(v_seats, ARRAY[v_sidx::text], jsonb_build_object(
                        'user_id', (v_change->>'user_id')::uuid,
                        'name', v_change->>'name',
                        'stack', (v_change->>'stack')::real,
                        'seat_idx', v_sidx,
                        'type', 'human',
                        'is_bot', false,
                        'last_seen', v_now
                    ));
                ELSE
                    -- Target seat no longer available; refund the user
                    UPDATE profiles SET bankroll = bankroll + (v_change->>'stack')::int, updated_at = NOW()
                    WHERE id = (v_change->>'user_id')::uuid;
                END IF;
            ELSIF (v_change->>'action') = 'leave' THEN
                v_sidx := (v_change->>'seat')::int;
                v_s := v_seats->v_sidx;
                IF (v_s->>'user_id') = (v_change->>'user_id') THEN
                    v_leaving_stack := (v_s->>'stack')::real;
                    IF v_leaving_stack > 0 THEN
                        UPDATE profiles SET bankroll = bankroll + ROUND(v_leaving_stack)::int, updated_at = NOW()
                        WHERE id = (v_change->>'user_id')::uuid;
                    END IF;
                    v_seats := jsonb_set(v_seats, ARRAY[v_sidx::text], jsonb_build_object(
                        'user_id', NULL,
                        'name', 'Bot ' || (v_sidx+1),
                        'stack', 100::real,
                        'seat_idx', v_sidx,
                        'type', 'bot',
                        'is_bot', true
                    ));
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- === Kick stale humans (no heartbeat in 15s) ===
    FOR i IN 0..5 LOOP
        v_s := v_seats->i;
        IF (v_s->>'type') = 'human' THEN
            v_last_seen := COALESCE((v_s->>'last_seen')::real, 0);
            IF v_now - v_last_seen > v_stale_threshold THEN
                v_stack := (v_s->>'stack')::real;
                IF v_stack > 0 AND (v_s->>'user_id') IS NOT NULL THEN
                    UPDATE profiles SET bankroll = bankroll + ROUND(v_stack)::int, updated_at = NOW()
                    WHERE id = (v_s->>'user_id')::uuid;
                END IF;
                v_seats := jsonb_set(v_seats, ARRAY[i::text], jsonb_build_object(
                    'user_id', NULL,
                    'name', 'Bot ' || (i+1),
                    'stack', 100::real,
                    'seat_idx', i,
                    'type', 'bot',
                    'is_bot', true
                ));
            END IF;
        END IF;
    END LOOP;

    -- Top-up broke bots (bots always restart at 100BB)
    FOR i IN 0..5 LOOP
        IF (v_seats->i->>'type') = 'bot' AND ((v_seats->i->>'stack')::real <= 0) THEN
            v_seats := jsonb_set(v_seats, ARRAY[i::text, 'stack'], to_jsonb(100.0));
        END IF;
    END LOOP;

    -- Count seats with chips
    FOR i IN 0..5 LOOP
        IF ((v_seats->i->>'stack')::real > 0) THEN
            v_active_count := v_active_count + 1;
        END IF;
    END LOOP;

    IF v_active_count < 2 THEN
        UPDATE pvp_room SET seats = v_seats, pending_changes = '[]'::jsonb, updated_at = NOW() WHERE id = 1;
        RETURN jsonb_build_object('error', 'need 2+ players', 'active', v_active_count);
    END IF;

    -- === Shuffle deck ===
    v_deck := ARRAY(
        SELECT r || s FROM
        unnest(ARRAY['2','3','4','5','6','7','8','9','T','J','Q','K','A']) AS r,
        unnest(ARRAY['c','d','h','s']) AS s
        ORDER BY random()
    );

    v_hand_num := v_room.hand_number + 1;

    -- Sit-out (fold) any seat with 0 stack
    v_folded := ARRAY[false, false, false, false, false, false];
    FOR i IN 0..5 LOOP
        IF ((v_seats->i->>'stack')::real <= 0) THEN
            v_folded[i+1] := true;
        END IF;
    END LOOP;

    -- Rotate dealer (skip sit-out)
    v_room.dealer_seat := (v_room.dealer_seat + 1) % 6;
    FOR i IN 0..5 LOOP
        IF NOT v_folded[v_room.dealer_seat+1] THEN EXIT; END IF;
        v_room.dealer_seat := (v_room.dealer_seat + 1) % 6;
    END LOOP;

    v_sb_seat := v_room.dealer_seat;
    FOR i IN 1..6 LOOP
        v_sb_seat := (v_sb_seat + 1) % 6;
        IF NOT v_folded[v_sb_seat+1] THEN EXIT; END IF;
    END LOOP;

    v_bb_seat := v_sb_seat;
    FOR i IN 1..6 LOOP
        v_bb_seat := (v_bb_seat + 1) % 6;
        IF NOT v_folded[v_bb_seat+1] THEN EXIT; END IF;
    END LOOP;

    v_first_seat := v_bb_seat;
    FOR i IN 1..6 LOOP
        v_first_seat := (v_first_seat + 1) % 6;
        IF NOT v_folded[v_first_seat+1] THEN EXIT; END IF;
    END LOOP;

    -- Deal cards
    DELETE FROM pvp_hands WHERE room_id = 1;
    FOR i IN 0..5 LOOP
        IF NOT v_folded[i+1] THEN
            v_cards := ARRAY[v_deck[i*2+1], v_deck[i*2+2]];
        ELSE
            v_cards := ARRAY[]::TEXT[];
        END IF;
        v_s := v_seats->i;
        INSERT INTO pvp_hands (room_id, seat_idx, user_id, cards, hand_number)
        VALUES (1, i, (v_s->>'user_id')::uuid, v_cards, v_hand_num);
    END LOOP;
    v_deck := v_deck[13:];

    -- Post blinds
    v_seats := jsonb_set(v_seats, ARRAY[v_sb_seat::text, 'stack'],
        to_jsonb(GREATEST(0::real, (v_seats->v_sb_seat->>'stack')::real - 0.5)));
    v_seats := jsonb_set(v_seats, ARRAY[v_bb_seat::text, 'stack'],
        to_jsonb(GREATEST(0::real, (v_seats->v_bb_seat->>'stack')::real - 1)));

    UPDATE pvp_room SET
        deck = v_deck,
        board = '{}',
        pot = 1.5,
        street = 'preflop',
        current_bet = 1,
        bets = ARRAY[0,0,0,0,0,0]::real[],
        folded = v_folded,
        all_in = ARRAY[false,false,false,false,false,false],
        dealer_seat = v_room.dealer_seat,
        acting_seat = v_first_seat,
        hand_number = v_hand_num,
        seats = v_seats,
        pending_changes = '[]'::jsonb,
        last_action = jsonb_build_object('closer', v_bb_seat, 'ts', v_now),
        updated_at = NOW()
    WHERE id = 1;

    UPDATE pvp_room SET
        bets[v_sb_seat+1] = 0.5,
        bets[v_bb_seat+1] = 1
    WHERE id = 1;

    RETURN jsonb_build_object('ok', true, 'hand', v_hand_num);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- pvp_stuck_fold: force-fold a human who hasn't acted in 30s
--   Safe for any client to call. Validates server-side.
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_stuck_fold()
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_last_ts REAL;
    v_now REAL := extract(epoch from now());
    v_acting_seat INTEGER;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;
    IF v_room.street = 'waiting' OR v_room.acting_seat < 0 THEN
        RETURN '{"error":"nothing to fold"}'::jsonb;
    END IF;
    v_last_ts := COALESCE((v_room.last_action->>'ts')::real, 0);
    IF v_now - v_last_ts < 30 THEN
        RETURN '{"error":"not stuck long enough"}'::jsonb;
    END IF;
    v_acting_seat := v_room.acting_seat;
    -- Call do_action as the stuck seat
    RETURN pvp_do_action(v_acting_seat, 'fold', 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- pvp_bot_action: wrapper with safe verification
--   Any client can call this. Server checks the acting seat is still
--   what they expected AND it's a bot seat. Uses FOR UPDATE lock.
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_bot_action(p_action TEXT, p_amount REAL DEFAULT 0)
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_seat INTEGER;
    v_s JSONB;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;
    v_seat := v_room.acting_seat;
    IF v_seat < 0 OR v_seat > 5 THEN RETURN '{"error":"no acting seat"}'::jsonb; END IF;
    v_s := v_room.seats->v_seat;
    IF (v_s->>'type') = 'human' AND (v_s->>'user_id') IS NOT NULL THEN
        RETURN '{"error":"acting seat is human"}'::jsonb;
    END IF;
    RETURN pvp_do_action(v_seat, p_action, p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Compatibility: keep old pvp_join / pvp_leave as aliases
-- so old frontend still works during migration
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_join(p_seat INTEGER) RETURNS JSONB AS $$
    SELECT pvp_sit_seat($1);
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.pvp_leave() RETURNS JSONB AS $$
    SELECT pvp_leave_seat();
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- GRANTS
-- ============================================================
GRANT EXECUTE ON FUNCTION public.pvp_sit_seat(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_leave_seat() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_deal() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_stuck_fold() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_bot_action(TEXT, REAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_join(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_leave() TO authenticated;

-- ============================================================
-- Reset room to clean state (run once at deploy)
-- ============================================================
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
    pending_changes = '[]'::jsonb,
    hand_number = 0,
    updated_at = NOW()
WHERE id = 1;

-- Reset all seats to bots (fresh start)
UPDATE pvp_room SET seats = (
    SELECT jsonb_agg(jsonb_build_object(
        'user_id', NULL,
        'name', 'Bot ' || (i+1),
        'stack', 100,
        'seat_idx', i,
        'type', 'bot',
        'is_bot', true
    ) ORDER BY i)
    FROM generate_series(0, 5) AS i
) WHERE id = 1;

DELETE FROM pvp_hands WHERE room_id = 1;
