-- ============================================================
-- PVP Complete Game Logic — REPLACE ALL previous pvp functions
-- Handles: action → advance → street change → showdown → payout
-- Run this in Supabase SQL Editor (replaces old functions)
-- ============================================================

-- Helper: find next active seat (not folded, not all-in)
CREATE OR REPLACE FUNCTION pvp_next_seat(p_from INTEGER, p_folded BOOLEAN[], p_allin BOOLEAN[])
RETURNS INTEGER AS $$
BEGIN
    FOR i IN 1..6 LOOP
        DECLARE v_next INTEGER := (p_from + i) % 6;
        BEGIN
            IF NOT p_folded[v_next + 1] AND NOT p_allin[v_next + 1] THEN
                RETURN v_next;
            END IF;
        END;
    END LOOP;
    RETURN -1;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper: count non-folded players
CREATE OR REPLACE FUNCTION pvp_active_count(p_folded BOOLEAN[])
RETURNS INTEGER AS $$
DECLARE cnt INTEGER := 0;
BEGIN
    FOR i IN 1..6 LOOP
        IF NOT p_folded[i] THEN cnt := cnt + 1; END IF;
    END LOOP;
    RETURN cnt;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper: simple hand evaluation (returns numeric score)
-- Higher = better. Uses board + hole cards.
CREATE OR REPLACE FUNCTION pvp_eval_hand(p_hole TEXT[], p_board TEXT[])
RETURNS REAL AS $$
DECLARE
    all_cards TEXT[];
    ranks INTEGER[];
    rv INTEGER;
    r TEXT;
    best REAL := 0;
    has_pair BOOLEAN := false;
    high_card INTEGER := 0;
BEGIN
    -- Simple ranking: pair > high card, use rank values
    -- This is simplified — real eval would need 5-card combination check
    all_cards := p_hole || p_board;
    ranks := ARRAY[]::INTEGER[];

    FOREACH r IN ARRAY all_cards LOOP
        CASE substring(r, 1, 1)
            WHEN 'A' THEN rv := 14;
            WHEN 'K' THEN rv := 13;
            WHEN 'Q' THEN rv := 12;
            WHEN 'J' THEN rv := 11;
            WHEN 'T' THEN rv := 10;
            ELSE rv := substring(r, 1, 1)::integer;
        END CASE;
        ranks := array_append(ranks, rv);
        IF rv > high_card THEN high_card := rv; END IF;
    END LOOP;

    -- Check for pairs/trips (simplified)
    best := high_card::real;
    FOR i IN 1..array_length(ranks, 1) LOOP
        FOR j IN (i+1)..array_length(ranks, 1) LOOP
            IF ranks[i] = ranks[j] THEN
                best := GREATEST(best, 100 + ranks[i]::real); -- pair
            END IF;
        END LOOP;
    END LOOP;

    -- Check for three of a kind
    FOR i IN 1..array_length(ranks, 1) LOOP
        DECLARE cnt INTEGER := 0;
        BEGIN
            FOR j IN 1..array_length(ranks, 1) LOOP
                IF ranks[j] = ranks[i] THEN cnt := cnt + 1; END IF;
            END LOOP;
            IF cnt >= 3 THEN best := GREATEST(best, 300 + ranks[i]::real); END IF;
            IF cnt >= 4 THEN best := GREATEST(best, 700 + ranks[i]::real); END IF;
        END;
    END LOOP;

    RETURN best + random() * 0.001; -- tiny random for tiebreak
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- MAIN: Process action + advance game state
-- Handles street transitions, dealing board, showdown
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_do_action(
    p_seat INTEGER,
    p_action TEXT,
    p_amount REAL DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_to_call REAL;
    v_stack REAL;
    v_actual REAL;
    v_active INTEGER;
    v_not_allin INTEGER;
    v_next INTEGER;
    v_round_done BOOLEAN;
    v_first_to_act INTEGER;
    v_sb INTEGER;
    v_bb INTEGER;
    v_all_matched BOOLEAN;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;
    IF v_room.acting_seat != p_seat THEN RETURN '{"error":"not your turn"}'::jsonb; END IF;

    v_stack := (v_room.seats->p_seat->>'stack')::real;
    v_to_call := GREATEST(0, v_room.current_bet - v_room.bets[p_seat + 1]);

    -- === PROCESS ACTION ===
    CASE p_action
        WHEN 'fold' THEN
            v_room.folded[p_seat + 1] := true;
        WHEN 'check' THEN
            NULL;
        WHEN 'call' THEN
            v_actual := LEAST(v_to_call, v_stack);
            v_room.bets[p_seat + 1] := v_room.bets[p_seat + 1] + v_actual;
            v_room.pot := v_room.pot + v_actual;
            v_stack := v_stack - v_actual;
            IF v_stack <= 0 THEN v_room.all_in[p_seat + 1] := true; END IF;
        WHEN 'raise', 'bet' THEN
            v_actual := LEAST(p_amount - v_room.bets[p_seat + 1], v_stack);
            v_room.pot := v_room.pot + v_actual;
            v_room.bets[p_seat + 1] := v_room.bets[p_seat + 1] + v_actual;
            v_room.current_bet := v_room.bets[p_seat + 1];
            v_stack := v_stack - v_actual;
            IF v_stack <= 0 THEN v_room.all_in[p_seat + 1] := true; END IF;
        WHEN 'allin' THEN
            v_room.pot := v_room.pot + v_stack;
            v_room.bets[p_seat + 1] := v_room.bets[p_seat + 1] + v_stack;
            IF v_room.bets[p_seat + 1] > v_room.current_bet THEN
                v_room.current_bet := v_room.bets[p_seat + 1];
            END IF;
            v_stack := 0;
            v_room.all_in[p_seat + 1] := true;
        ELSE
            RETURN '{"error":"invalid action"}'::jsonb;
    END CASE;

    -- Update stack
    v_room.seats := jsonb_set(v_room.seats, ARRAY[p_seat::text, 'stack'], to_jsonb(v_stack));

    -- Record action
    v_room.last_action := jsonb_build_object(
        'seat', p_seat, 'action', p_action, 'amount', p_amount,
        'ts', extract(epoch from now())
    );

    -- === CHECK GAME STATE ===
    v_active := pvp_active_count(v_room.folded);

    -- Only 1 player left → they win
    IF v_active <= 1 THEN
        -- Find winner (only non-folded seat)
        FOR i IN 0..5 LOOP
            IF NOT v_room.folded[i + 1] THEN
                v_room.seats := jsonb_set(v_room.seats, ARRAY[i::text, 'stack'],
                    to_jsonb(((v_room.seats->i->>'stack')::real) + v_room.pot));
                v_room.last_action := jsonb_build_object('winner', i, 'amount', v_room.pot,
                    'ts', extract(epoch from now()));
                EXIT;
            END IF;
        END LOOP;
        v_room.street := 'waiting';
        v_room.pot := 0;
        v_room.acting_seat := -1;
        UPDATE pvp_room SET seats=v_room.seats, pot=v_room.pot, street=v_room.street,
            current_bet=0, bets='{0,0,0,0,0,0}', folded=v_room.folded, all_in=v_room.all_in,
            acting_seat=v_room.acting_seat, last_action=v_room.last_action,
            board=v_room.board, updated_at=NOW() WHERE id=1;
        RETURN jsonb_build_object('ok', true, 'result', 'fold_win');
    END IF;

    -- Count players who can still act (not folded, not all-in)
    v_not_allin := 0;
    FOR i IN 1..6 LOOP
        IF NOT v_room.folded[i] AND NOT v_room.all_in[i] THEN v_not_allin := v_not_allin + 1; END IF;
    END LOOP;

    -- Check if betting round is complete
    v_next := pvp_next_seat(p_seat, v_room.folded, v_room.all_in);
    v_all_matched := true;
    FOR i IN 1..6 LOOP
        IF NOT v_room.folded[i] AND NOT v_room.all_in[i] AND v_room.bets[i] < v_room.current_bet THEN
            v_all_matched := false;
            EXIT;
        END IF;
    END LOOP;

    -- Determine if round is over
    -- Round is over when: everyone still active has matched the current bet
    -- AND we've gone around (the raise action resets this — handled by checking all matched)
    IF p_action = 'raise' OR p_action = 'bet' THEN
        -- Raise reopens action — find next player
        v_room.acting_seat := v_next;
    ELSIF v_all_matched OR v_not_allin <= 1 THEN
        -- === ADVANCE STREET ===
        -- Reset bets
        v_room.bets := '{0,0,0,0,0,0}'::real[];
        v_room.current_bet := 0;

        IF v_not_allin <= 1 THEN
            -- All-in runout: deal remaining board and showdown
            WHILE array_length(v_room.board, 1) IS NULL OR array_length(v_room.board, 1) < 5 LOOP
                v_room.deck := v_room.deck[2:]; -- burn
                v_room.board := array_append(v_room.board, v_room.deck[1]);
                v_room.deck := v_room.deck[2:];
            END LOOP;
            -- Showdown
            PERFORM pvp_showdown();
            SELECT * INTO v_room FROM pvp_room WHERE id = 1;
            RETURN jsonb_build_object('ok', true, 'result', 'showdown');
        END IF;

        IF v_room.street = 'preflop' THEN
            v_room.street := 'flop';
            v_room.deck := v_room.deck[2:]; -- burn
            v_room.board := array_append(v_room.board, v_room.deck[1]);
            v_room.deck := v_room.deck[2:];
            v_room.board := array_append(v_room.board, v_room.deck[1]);
            v_room.deck := v_room.deck[2:];
            v_room.board := array_append(v_room.board, v_room.deck[1]);
            v_room.deck := v_room.deck[2:];
        ELSIF v_room.street = 'flop' THEN
            v_room.street := 'turn';
            v_room.deck := v_room.deck[2:]; -- burn
            v_room.board := array_append(v_room.board, v_room.deck[1]);
            v_room.deck := v_room.deck[2:];
        ELSIF v_room.street = 'turn' THEN
            v_room.street := 'river';
            v_room.deck := v_room.deck[2:]; -- burn
            v_room.board := array_append(v_room.board, v_room.deck[1]);
            v_room.deck := v_room.deck[2:];
        ELSIF v_room.street = 'river' THEN
            -- Showdown
            PERFORM pvp_showdown();
            SELECT * INTO v_room FROM pvp_room WHERE id = 1;
            RETURN jsonb_build_object('ok', true, 'result', 'showdown');
        END IF;

        -- First to act postflop: first active seat after dealer
        v_room.acting_seat := pvp_next_seat(v_room.dealer_seat, v_room.folded, v_room.all_in);
    ELSE
        -- Round not done, advance to next player
        v_room.acting_seat := v_next;
    END IF;

    UPDATE pvp_room SET seats=v_room.seats, pot=v_room.pot, street=v_room.street, deck=v_room.deck,
        current_bet=v_room.current_bet, bets=v_room.bets, folded=v_room.folded, all_in=v_room.all_in,
        acting_seat=v_room.acting_seat, last_action=v_room.last_action,
        board=v_room.board, updated_at=NOW() WHERE id=1;

    RETURN jsonb_build_object('ok', true, 'street', v_room.street, 'acting', v_room.acting_seat);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Showdown: evaluate hands, award pot, reset to waiting
-- ============================================================
CREATE OR REPLACE FUNCTION pvp_showdown()
RETURNS void AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_best_score REAL := -1;
    v_winner INTEGER := -1;
    v_score REAL;
    v_hand pvp_hands%ROWTYPE;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;

    -- Evaluate each non-folded player's hand
    FOR i IN 0..5 LOOP
        IF NOT v_room.folded[i + 1] THEN
            SELECT * INTO v_hand FROM pvp_hands
                WHERE room_id = 1 AND seat_idx = i AND hand_number = v_room.hand_number;

            IF v_hand IS NOT NULL AND v_hand.cards IS NOT NULL THEN
                v_score := pvp_eval_hand(v_hand.cards, v_room.board);
                IF v_score > v_best_score THEN
                    v_best_score := v_score;
                    v_winner := i;
                END IF;
            END IF;
        END IF;
    END LOOP;

    -- Award pot to winner
    IF v_winner >= 0 THEN
        v_room.seats := jsonb_set(v_room.seats, ARRAY[v_winner::text, 'stack'],
            to_jsonb(((v_room.seats->v_winner->>'stack')::real) + v_room.pot));
    END IF;

    -- Reset for next hand
    v_room.last_action := jsonb_build_object('winner', v_winner, 'amount', v_room.pot,
        'showdown', true, 'ts', extract(epoch from now()));

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

-- ============================================================
-- Player action wrapper (validates auth + calls pvp_do_action)
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_action(p_action TEXT, p_amount REAL DEFAULT 0)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_room pvp_room%ROWTYPE;
    v_seat INTEGER := -1;
BEGIN
    IF v_user_id IS NULL THEN RETURN '{"error":"not authenticated"}'::jsonb; END IF;
    SELECT * INTO v_room FROM pvp_room WHERE id = 1;

    FOR i IN 0..5 LOOP
        IF (v_room.seats->i->>'user_id') = v_user_id::text THEN v_seat := i; EXIT; END IF;
    END LOOP;

    IF v_seat < 0 THEN RETURN '{"error":"not in room"}'::jsonb; END IF;
    RETURN pvp_do_action(v_seat, p_action, p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Bot action wrapper (validates seat is bot)
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_bot_action(p_action TEXT, p_amount REAL DEFAULT 0)
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_seat INTEGER;
    v_is_bot BOOLEAN;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1;
    v_seat := v_room.acting_seat;
    IF v_seat < 0 OR v_seat > 5 THEN RETURN '{"error":"no acting seat"}'::jsonb; END IF;

    v_is_bot := COALESCE((v_room.seats->v_seat->>'is_bot')::boolean, false);
    IF NOT v_is_bot THEN RETURN '{"error":"not a bot"}'::jsonb; END IF;

    RETURN pvp_do_action(v_seat, p_action, p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grants
GRANT EXECUTE ON FUNCTION public.pvp_do_action(INTEGER, TEXT, REAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_action(TEXT, REAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_bot_action(TEXT, REAL) TO authenticated;
GRANT EXECUTE ON FUNCTION pvp_showdown() TO authenticated;
GRANT EXECUTE ON FUNCTION pvp_next_seat(INTEGER, BOOLEAN[], BOOLEAN[]) TO authenticated;
GRANT EXECUTE ON FUNCTION pvp_active_count(BOOLEAN[]) TO authenticated;
GRANT EXECUTE ON FUNCTION pvp_eval_hand(TEXT[], TEXT[]) TO authenticated;

-- Reset room for fresh start
UPDATE pvp_room SET street='waiting', seats='[]'::jsonb, hand_number=0,
    acting_seat=-1, pot=0, bets='{0,0,0,0,0,0}', folded='{f,f,f,f,f,f}',
    all_in='{f,f,f,f,f,f}', board='{}', deck='{}', current_bet=0 WHERE id=1;
DELETE FROM pvp_hands WHERE room_id = 1;
