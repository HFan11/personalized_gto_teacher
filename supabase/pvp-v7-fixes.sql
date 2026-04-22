-- pvp-v7-fixes.sql
-- Three server-side fixes found during end-to-end testing:
--   1. Chip conservation: pvp_showdown could fail to find a winner
--      (v_winner stayed at -1) and the pot would then be silently
--      cleared to 0 without being awarded → chips vanish from the
--      table. ~6 BB per hand observed in bot-only play.
--   2. Stale-kick too aggressive: 15s with no heartbeat → human
--      kicked out of seat. Raised to 60s.
--   3. pvp_bot_action had no cooldown, letting a malicious client
--      spam it. Added lightweight guard.

-- ============================================================
-- FIX 1: chip conservation in pvp_showdown
-- ============================================================
-- The old function did `SELECT * INTO v_hand` and relied on
-- `v_hand IS NOT NULL` which is a rowtype check that can misfire.
-- Rewritten to use an explicit FOUND guard + ALWAYS award the pot,
-- falling back to the first non-folded seat if no valid hand eval
-- produced a winner. This guarantees chips never vanish.

CREATE OR REPLACE FUNCTION pvp_showdown()
RETURNS void AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_best_score REAL := -1;
    v_winner INTEGER := -1;
    v_score REAL;
    v_cards TEXT[];
    v_fallback INTEGER := -1;
    i INTEGER;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;

    -- Evaluate each non-folded seat. Remember the first non-folded
    -- seat as a guaranteed fallback winner so pot always goes SOMEWHERE.
    FOR i IN 0..5 LOOP
        IF NOT v_room.folded[i + 1] THEN
            IF v_fallback = -1 THEN v_fallback := i; END IF;

            -- Explicit SELECT that definitively returns cards or NULL
            SELECT cards INTO v_cards
            FROM pvp_hands
            WHERE room_id = 1 AND seat_idx = i AND hand_number = v_room.hand_number
            LIMIT 1;

            IF FOUND AND v_cards IS NOT NULL AND array_length(v_cards, 1) >= 2 THEN
                v_score := pvp_eval_hand(v_cards, v_room.board);
                IF v_score IS NOT NULL AND v_score > v_best_score THEN
                    v_best_score := v_score;
                    v_winner := i;
                END IF;
            END IF;
        END IF;
    END LOOP;

    -- Guarantee: if hand evaluation didn't produce a winner, award
    -- the pot to the first non-folded seat. Chips never vanish.
    IF v_winner = -1 AND v_fallback >= 0 THEN
        v_winner := v_fallback;
        RAISE NOTICE 'pvp_showdown: hand eval failed, falling back to seat %', v_winner;
    END IF;

    -- Award pot
    IF v_winner >= 0 THEN
        v_room.seats := jsonb_set(
            v_room.seats,
            ARRAY[v_winner::text, 'stack'],
            to_jsonb(((v_room.seats->v_winner->>'stack')::real) + v_room.pot)
        );
    END IF;

    v_room.last_action := jsonb_build_object(
        'winner', v_winner,
        'amount', v_room.pot,
        'type', 'showdown',
        'ts', extract(epoch from now())
    );

    UPDATE pvp_room SET
        seats = v_room.seats,
        street = 'waiting',
        pot = 0,
        current_bet = 0,
        bets = '{0,0,0,0,0,0}',
        acting_seat = -1,
        last_action = v_room.last_action,
        updated_at = NOW()
    WHERE id = 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION pvp_showdown() TO authenticated;

-- ============================================================
-- FIX 2: stale-kick threshold 15s → 60s
-- ============================================================
-- Rewrite of pvp_deal with the only change being v_stale_threshold.
-- Everything else is identical to pvp-v6.sql. Kept entirely here so
-- future readers don't have to cross-reference versions.

CREATE OR REPLACE FUNCTION public.pvp_deal()
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_seats JSONB;
    v_changes JSONB;
    v_change JSONB;
    v_now DOUBLE PRECISION := extract(epoch from now());
    v_stale_threshold DOUBLE PRECISION := 60.0;   -- was 15.0 — too aggressive
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

        -- Apply leave: seat becomes bot with stack 0
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
                    'stack', 0::real,
                    'seat_idx', i, 'type', 'bot', 'is_bot', true
                );
            END IF;
        END IF;

        -- Apply sit (unchanged from v6)
        IF v_sits_map ? i::text THEN
            v_change := v_sits_map->(i::text);
            IF (v_s->>'is_bot')::boolean IS TRUE OR v_s->>'user_id' IS NULL THEN
                v_s := jsonb_build_object(
                    'user_id', v_change->>'user_id',
                    'name', COALESCE(v_change->>'name', 'Player'),
                    'stack', COALESCE((v_change->>'stack')::real, 100::real),
                    'seat_idx', i,
                    'type', 'human',
                    'is_bot', false,
                    'last_seen', v_now
                );
                v_just_sat := true;
            END IF;
        END IF;

        -- Kick stale humans (threshold now 60s — was 15s)
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
                    'stack', 0::real,
                    'seat_idx', i, 'type', 'bot', 'is_bot', true
                );
            END IF;
        END IF;

        v_new_seats := v_new_seats || v_s;
    END LOOP;

    v_seats := v_new_seats;

    v_active_count := 0;
    FOR i IN 0..5 LOOP
        v_s := v_seats->i;
        IF COALESCE((v_s->>'stack')::real, 0) > 0 THEN
            v_active_count := v_active_count + 1;
        END IF;
    END LOOP;

    IF v_active_count < 2 THEN
        UPDATE pvp_room SET seats = v_seats, pending_changes = '[]'::jsonb, updated_at = NOW() WHERE id = 1;
        RETURN '{"error":"not enough players"}'::jsonb;
    END IF;

    -- Rotate dealer + find SB/BB/first-to-act (preflop: UTG = BB+1)
    v_folded := ARRAY[false,false,false,false,false,false]::boolean[];
    FOR i IN 0..5 LOOP
        IF COALESCE((v_seats->i->>'stack')::real, 0) <= 0 THEN
            v_folded[i+1] := true;
        END IF;
    END LOOP;

    v_room.dealer_seat := (COALESCE(v_room.dealer_seat, -1) + 1) % 6;
    FOR i IN 1..6 LOOP
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

    v_hand_num := v_room.hand_number + 1;
    v_deck := pvp_shuffle();

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

GRANT EXECUTE ON FUNCTION public.pvp_deal() TO authenticated;

-- ============================================================
-- FIX 3: pvp_bot_action cooldown / throttle
-- ============================================================
-- Any authenticated user can call pvp_bot_action (the client uses it
-- to drive bot decisions). Without a cooldown a malicious client
-- could hammer it + observe the room race-condition. Lightweight
-- guard: reject if another bot_action fired <200ms ago.

CREATE OR REPLACE FUNCTION public.pvp_bot_action(p_action TEXT, p_amount REAL DEFAULT 0)
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_seat_idx INTEGER;
    v_seat JSONB;
    v_is_bot BOOLEAN;
    v_now DOUBLE PRECISION := extract(epoch from now());
    v_last_bot_ts DOUBLE PRECISION;
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

    -- Delegate actual gameplay to pvp_do_action (so logic is identical to human path)
    -- Tag last_action so the throttle sees this call
    UPDATE pvp_room
    SET last_action = COALESCE(last_action, '{}'::jsonb) || jsonb_build_object('bot_ts', v_now)
    WHERE id = 1;

    RETURN pvp_do_action(v_seat_idx, p_action, p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.pvp_bot_action(TEXT, REAL) TO authenticated;

-- ============================================================
-- BONUS: conservation probe RPC (call from admin console to sanity-check)
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_conservation_check()
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_stack_sum REAL := 0;
    v_bet_sum REAL := 0;
    i INTEGER;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1;
    FOR i IN 0..5 LOOP
        v_stack_sum := v_stack_sum + COALESCE((v_room.seats->i->>'stack')::real, 0);
    END LOOP;
    FOR i IN 1..6 LOOP
        v_bet_sum := v_bet_sum + COALESCE(v_room.bets[i], 0);
    END LOOP;
    RETURN jsonb_build_object(
        'stacks_sum', v_stack_sum,
        'bets_sum', v_bet_sum,
        'pot', v_room.pot,
        'total', v_stack_sum + v_bet_sum + v_room.pot,
        'street', v_room.street,
        'hand', v_room.hand_number
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.pvp_conservation_check() TO authenticated;
