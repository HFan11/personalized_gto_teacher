-- ============================================================
-- PVP v6: fix chip printing + human-vs-human showdown reveal + table restart
-- Run ENTIRE file in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1. Fixed pvp_deal: NO auto-topup, bot-replaced seats start at 0
-- ============================================================
-- The old v5 minted 100 chips every time a user left (seat became a
-- fresh 100BB bot). Now seats left by users become stack-0 bots,
-- preserving total chip conservation. Bots that bust stay at 0 and
-- sit out that hand. Use pvp_restart_table() to refill.
CREATE OR REPLACE FUNCTION public.pvp_deal()
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_seats JSONB;
    v_changes JSONB;
    v_change JSONB;
    v_now DOUBLE PRECISION := extract(epoch from now());
    v_stale_threshold DOUBLE PRECISION := 15.0;
    v_hand_num INTEGER;
    v_deck TEXT[];
    v_folded BOOLEAN[];
    v_sb_seat INTEGER;
    v_bb_seat INTEGER;
    v_first_seat INTEGER;
    v_cards TEXT[];
    v_stack REAL;
    v_last_seen DOUBLE PRECISION;
    v_active_count INTEGER := 0;
    v_s JSONB;
    v_leaving_stack REAL;
    v_new_seats JSONB;
    v_sits_map JSONB := '{}'::jsonb;
    v_leaves_map JSONB := '{}'::jsonb;
    v_just_sat BOOLEAN;
    i INTEGER;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;
    IF v_room.street != 'waiting' THEN
        RETURN '{"error":"hand in progress"}'::jsonb;
    END IF;

    v_seats := v_room.seats;
    v_changes := COALESCE(v_room.pending_changes, '[]'::jsonb);

    IF v_seats IS NULL OR jsonb_typeof(v_seats) != 'array' OR jsonb_array_length(v_seats) < 6 THEN
        v_seats := '[]'::jsonb;
        FOR i IN 0..5 LOOP
            v_seats := v_seats || jsonb_build_object(
                'user_id', NULL, 'name', 'Bot ' || (i+1), 'stack', 100,
                'seat_idx', i, 'type', 'bot', 'is_bot', true
            );
        END LOOP;
    END IF;

    IF jsonb_array_length(v_changes) > 0 THEN
        FOR i IN 0..jsonb_array_length(v_changes)-1 LOOP
            v_change := v_changes->i;
            IF (v_change->>'action') = 'sit' THEN
                v_sits_map := jsonb_set(v_sits_map, ARRAY[v_change->>'seat'], v_change);
            ELSIF (v_change->>'action') = 'leave' THEN
                v_leaves_map := jsonb_set(v_leaves_map, ARRAY[v_change->>'seat'], v_change);
            END IF;
        END LOOP;
    END IF;

    v_new_seats := '[]'::jsonb;
    FOR i IN 0..5 LOOP
        v_s := v_seats->i;
        v_just_sat := false;

        -- Apply leave: seat becomes bot with stack 0 (NOT 100 — was printing chips)
        IF v_leaves_map ? i::text THEN
            v_change := v_leaves_map->(i::text);
            IF (v_s->>'user_id') = (v_change->>'user_id') THEN
                v_leaving_stack := COALESCE((v_s->>'stack')::real, 0);
                IF v_leaving_stack > 0 THEN
                    UPDATE profiles SET bankroll = bankroll + ROUND(v_leaving_stack)::int, updated_at = NOW()
                    WHERE id = (v_change->>'user_id')::uuid;
                END IF;
                v_s := jsonb_build_object(
                    'user_id', NULL, 'name', 'Bot ' || (i+1),
                    'stack', 0::real,  -- ← FIX: was 100, now 0 (no minting)
                    'seat_idx', i, 'type', 'bot', 'is_bot', true
                );
            END IF;
        END IF;

        -- Apply sit: user has already been deducted (in pvp_sit_seat)
        IF v_sits_map ? i::text THEN
            v_change := v_sits_map->(i::text);
            IF (v_s->>'type') = 'bot' THEN
                v_s := jsonb_build_object(
                    'user_id', (v_change->>'user_id')::uuid,
                    'name', v_change->>'name',
                    'stack', (v_change->>'stack')::real,
                    'seat_idx', i, 'type', 'human', 'is_bot', false,
                    'last_seen', v_now
                );
                v_just_sat := true;
            ELSE
                -- Seat no longer available: refund
                UPDATE profiles SET bankroll = bankroll + (v_change->>'stack')::int, updated_at = NOW()
                WHERE id = (v_change->>'user_id')::uuid;
            END IF;
        END IF;

        -- Kick stale humans (not just-sat)
        IF NOT v_just_sat AND (v_s->>'type') = 'human' THEN
            v_last_seen := COALESCE((v_s->>'last_seen')::double precision, 0);
            IF v_last_seen > 0 AND v_now - v_last_seen > v_stale_threshold THEN
                v_stack := COALESCE((v_s->>'stack')::real, 0);
                IF v_stack > 0 AND (v_s->>'user_id') IS NOT NULL THEN
                    UPDATE profiles SET bankroll = bankroll + ROUND(v_stack)::int, updated_at = NOW()
                    WHERE id = (v_s->>'user_id')::uuid;
                END IF;
                v_s := jsonb_build_object(
                    'user_id', NULL, 'name', 'Bot ' || (i+1),
                    'stack', 0::real,  -- ← FIX: stale-kick also leaves bot at 0
                    'seat_idx', i, 'type', 'bot', 'is_bot', true
                );
            END IF;
        END IF;

        -- REMOVED: auto-topup of 0-stack bots (was minting chips)
        -- Players need to call pvp_restart_table() to refresh the table.

        v_new_seats := v_new_seats || v_s;
    END LOOP;

    v_seats := v_new_seats;

    v_active_count := 0;
    FOR i IN 0..5 LOOP
        IF COALESCE((v_seats->i->>'stack')::real, 0) > 0 THEN
            v_active_count := v_active_count + 1;
        END IF;
    END LOOP;

    IF v_active_count < 2 THEN
        UPDATE pvp_room SET seats = v_seats, pending_changes = '[]'::jsonb, updated_at = NOW() WHERE id = 1;
        RETURN jsonb_build_object('error', 'need 2+ players with chips', 'active', v_active_count);
    END IF;

    v_deck := ARRAY(
        SELECT r || s FROM
        unnest(ARRAY['2','3','4','5','6','7','8','9','T','J','Q','K','A']) AS r,
        unnest(ARRAY['c','d','h','s']) AS s
        ORDER BY random()
    );

    v_hand_num := v_room.hand_number + 1;

    v_folded := ARRAY[false, false, false, false, false, false];
    FOR i IN 0..5 LOOP
        IF COALESCE((v_seats->i->>'stack')::real, 0) <= 0 THEN
            v_folded[i+1] := true;
        END IF;
    END LOOP;

    v_room.dealer_seat := (COALESCE(v_room.dealer_seat, 0) + 1) % 6;
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

    DELETE FROM pvp_hands WHERE room_id = 1;
    FOR i IN 0..5 LOOP
        IF NOT v_folded[i+1] THEN
            v_cards := ARRAY[v_deck[i*2+1], v_deck[i*2+2]];
        ELSE
            v_cards := ARRAY[]::TEXT[];
        END IF;
        v_s := v_seats->i;
        INSERT INTO pvp_hands (room_id, seat_idx, user_id, cards, hand_number)
        VALUES (1, i, NULLIF(v_s->>'user_id','')::uuid, v_cards, v_hand_num);
    END LOOP;
    v_deck := v_deck[13:];

    v_seats := jsonb_set(v_seats, ARRAY[v_sb_seat::text, 'stack'],
        to_jsonb(GREATEST(0::real, COALESCE((v_seats->v_sb_seat->>'stack')::real, 0) - 0.5)));
    v_seats := jsonb_set(v_seats, ARRAY[v_bb_seat::text, 'stack'],
        to_jsonb(GREATEST(0::real, COALESCE((v_seats->v_bb_seat->>'stack')::real, 0) - 1)));

    UPDATE pvp_room SET
        deck = v_deck, board = '{}', pot = 1.5, street = 'preflop',
        current_bet = 1, bets = ARRAY[0,0,0,0,0,0]::real[],
        folded = v_folded, all_in = ARRAY[false,false,false,false,false,false],
        dealer_seat = v_room.dealer_seat, acting_seat = v_first_seat,
        hand_number = v_hand_num, seats = v_seats,
        pending_changes = '[]'::jsonb,
        last_action = jsonb_build_object('closer', v_bb_seat, 'ts', v_now),
        updated_at = NOW()
    WHERE id = 1;

    UPDATE pvp_room SET bets[v_sb_seat+1] = 0.5, bets[v_bb_seat+1] = 1 WHERE id = 1;

    RETURN jsonb_build_object('ok', true, 'hand', v_hand_num);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. pvp_restart_table: refill all bot seats to 100BB.
-- Call when room runs out of chips (optional UX button).
-- Does NOT affect human seats.
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_restart_table()
RETURNS JSONB AS $$
DECLARE
    v_seats JSONB;
    v_s JSONB;
    v_new_seats JSONB := '[]'::jsonb;
    i INTEGER;
BEGIN
    SELECT seats INTO v_seats FROM pvp_room WHERE id = 1 FOR UPDATE;
    FOR i IN 0..5 LOOP
        v_s := v_seats->i;
        IF (v_s->>'type') = 'bot' THEN
            v_s := jsonb_set(v_s, ARRAY['stack'], to_jsonb(100.0));
        END IF;
        v_new_seats := v_new_seats || v_s;
    END LOOP;
    UPDATE pvp_room SET seats = v_new_seats, updated_at = NOW() WHERE id = 1;
    RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. pvp_showdown_hands: return all hole cards for a hand
-- (for human-vs-human showdown reveal). SECURITY DEFINER bypasses RLS.
-- Only works when that hand is at showdown.
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_showdown_hands(p_hand_num INTEGER)
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_result JSONB := '{}'::jsonb;
    v_h pvp_hands%ROWTYPE;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1;
    -- Only reveal if this hand is at showdown OR just ended (waiting + showdown type)
    IF v_room.hand_number != p_hand_num THEN
        RETURN jsonb_build_object('error', 'wrong hand');
    END IF;
    IF v_room.street != 'waiting' OR COALESCE(v_room.last_action->>'type', '') != 'showdown' THEN
        RETURN jsonb_build_object('error', 'not at showdown');
    END IF;
    -- Return hands for non-folded seats only (folded players' cards stay hidden)
    FOR v_h IN
        SELECT * FROM pvp_hands
        WHERE room_id = 1 AND hand_number = p_hand_num
    LOOP
        IF NOT v_room.folded[v_h.seat_idx + 1] AND v_h.cards IS NOT NULL AND array_length(v_h.cards, 1) >= 2 THEN
            v_result := jsonb_set(v_result, ARRAY[v_h.seat_idx::text], to_jsonb(v_h.cards));
        END IF;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'hands', v_result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.pvp_deal() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_restart_table() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_showdown_hands(INTEGER) TO authenticated;

-- Reset all bot stacks to 100 (clean slate after the deploy)
UPDATE pvp_room SET seats = (
    SELECT jsonb_agg(
        CASE WHEN (s->>'type') = 'bot'
            THEN jsonb_set(s, ARRAY['stack'], to_jsonb(100.0))
            ELSE s
        END ORDER BY (s->>'seat_idx')::int
    )
    FROM jsonb_array_elements(seats) s
) WHERE id = 1;
