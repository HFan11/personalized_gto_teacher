-- ============================================================
-- PVP Game Fix — Complete Replacement
-- Run this ENTIRE file in Supabase SQL Editor (one go)
-- Fixes: round-complete detection, BB option, street advance,
--         hand evaluation, showdown, fold-win
-- ============================================================

-- ============ HELPER FUNCTIONS ============

-- Find next active seat (not folded, not all-in) clockwise from p_from
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

-- Find previous active seat (not folded, not all-in) counter-clockwise from p_from
-- Used to determine the "closer" — the last seat that must act before round ends
CREATE OR REPLACE FUNCTION pvp_prev_active_seat(p_from INTEGER, p_folded BOOLEAN[], p_allin BOOLEAN[])
RETURNS INTEGER AS $$
BEGIN
    FOR i IN 1..5 LOOP
        DECLARE v_prev INTEGER := (p_from - i + 6) % 6;
        BEGIN
            IF NOT p_folded[v_prev + 1] AND NOT p_allin[v_prev + 1] THEN
                RETURN v_prev;
            END IF;
        END;
    END LOOP;
    RETURN p_from;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Count non-folded players
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

-- ============ HAND EVALUATION ============
-- Handles: high card, pair, two pair, trips, straight, flush,
--          full house, quads, straight flush
-- Scoring: category * 1000 + rank-based tiebreakers
CREATE OR REPLACE FUNCTION pvp_eval_hand(p_hole TEXT[], p_board TEXT[])
RETURNS REAL AS $$
DECLARE
    all_cards TEXT[];
    n_cards INTEGER;
    ranks INTEGER[];
    suits INTEGER[];
    rank_cnt INTEGER[15];  -- index 1..14, rank_cnt[r] = count
    suit_cnt INTEGER[4];   -- suits: c=1,d=2,h=3,s=4
    rv INTEGER;
    sv INTEGER;
    i INTEGER;
    j INTEGER;

    -- Hand detection
    v_high_card INTEGER := 0;
    v_pairs INTEGER[] := ARRAY[]::INTEGER[];  -- ranks of pairs
    v_trips_rank INTEGER := 0;
    v_quads_rank INTEGER := 0;
    v_flush_suit INTEGER := 0;    -- suit with 5+ cards (0 = none)
    v_flush_high INTEGER := 0;
    v_straight_high INTEGER := 0;  -- highest card in best straight
    v_sf_high INTEGER := 0;        -- straight flush high card

    -- Temp
    consec INTEGER;
    suit_ranks INTEGER[];
    best REAL := 0;
BEGIN
    all_cards := p_hole || COALESCE(p_board, ARRAY[]::TEXT[]);
    n_cards := array_length(all_cards, 1);
    IF n_cards IS NULL OR n_cards < 2 THEN RETURN 0; END IF;

    ranks := ARRAY[]::INTEGER[];
    suits := ARRAY[]::INTEGER[];
    rank_cnt := ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0]::INTEGER[];
    suit_cnt := ARRAY[0,0,0,0]::INTEGER[];

    -- Parse all cards
    FOR i IN 1..n_cards LOOP
        CASE substring(all_cards[i], 1, 1)
            WHEN 'A' THEN rv := 14;
            WHEN 'K' THEN rv := 13;
            WHEN 'Q' THEN rv := 12;
            WHEN 'J' THEN rv := 11;
            WHEN 'T' THEN rv := 10;
            ELSE rv := substring(all_cards[i], 1, 1)::integer;
        END CASE;
        CASE substring(all_cards[i], 2, 1)
            WHEN 'c' THEN sv := 1;
            WHEN 'd' THEN sv := 2;
            WHEN 'h' THEN sv := 3;
            WHEN 's' THEN sv := 4;
            ELSE sv := 1;
        END CASE;
        ranks := array_append(ranks, rv);
        suits := array_append(suits, sv);
        rank_cnt[rv] := rank_cnt[rv] + 1;
        suit_cnt[sv] := suit_cnt[sv] + 1;
        IF rv > v_high_card THEN v_high_card := rv; END IF;
    END LOOP;

    -- Detect pairs, trips, quads
    FOR i IN 2..14 LOOP
        IF rank_cnt[i] >= 4 THEN
            v_quads_rank := GREATEST(v_quads_rank, i);
        END IF;
        IF rank_cnt[i] >= 3 THEN
            v_trips_rank := GREATEST(v_trips_rank, i);
        END IF;
        IF rank_cnt[i] >= 2 THEN
            v_pairs := array_append(v_pairs, i);
        END IF;
    END LOOP;
    -- Sort pairs descending (highest first)
    IF array_length(v_pairs, 1) > 1 THEN
        FOR i IN 1..array_length(v_pairs, 1)-1 LOOP
            FOR j IN i+1..array_length(v_pairs, 1) LOOP
                IF v_pairs[j] > v_pairs[i] THEN
                    rv := v_pairs[i]; v_pairs[i] := v_pairs[j]; v_pairs[j] := rv;
                END IF;
            END LOOP;
        END LOOP;
    END IF;

    -- Detect flush (5+ cards of same suit)
    FOR i IN 1..4 LOOP
        IF suit_cnt[i] >= 5 THEN
            v_flush_suit := i;
            -- Find highest card in this suit
            FOR j IN 1..n_cards LOOP
                IF suits[j] = i AND ranks[j] > v_flush_high THEN
                    v_flush_high := ranks[j];
                END IF;
            END LOOP;
        END IF;
    END LOOP;

    -- Detect straight (5 consecutive ranks among all cards)
    FOR i IN REVERSE 14..6 LOOP
        IF rank_cnt[i] > 0 AND rank_cnt[i-1] > 0 AND rank_cnt[i-2] > 0
           AND rank_cnt[i-3] > 0 AND rank_cnt[i-4] > 0 THEN
            v_straight_high := i;
            EXIT;
        END IF;
    END LOOP;
    -- Wheel: A-2-3-4-5
    IF v_straight_high = 0 AND rank_cnt[14] > 0 AND rank_cnt[2] > 0
       AND rank_cnt[3] > 0 AND rank_cnt[4] > 0 AND rank_cnt[5] > 0 THEN
        v_straight_high := 5;
    END IF;

    -- Detect straight flush (5 consecutive ranks of same suit)
    IF v_flush_suit > 0 AND v_straight_high > 0 THEN
        -- Check if the flush suit cards form a straight
        suit_ranks := ARRAY[]::INTEGER[];
        FOR j IN 1..n_cards LOOP
            IF suits[j] = v_flush_suit THEN
                suit_ranks := array_append(suit_ranks, ranks[j]);
            END IF;
        END LOOP;
        -- Build rank presence array for flush suit
        DECLARE sf_cnt INTEGER[15] := ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0]::INTEGER[];
        BEGIN
            FOR j IN 1..array_length(suit_ranks, 1) LOOP
                sf_cnt[suit_ranks[j]] := 1;
            END LOOP;
            FOR i IN REVERSE 14..6 LOOP
                IF sf_cnt[i] > 0 AND sf_cnt[i-1] > 0 AND sf_cnt[i-2] > 0
                   AND sf_cnt[i-3] > 0 AND sf_cnt[i-4] > 0 THEN
                    v_sf_high := i;
                    EXIT;
                END IF;
            END LOOP;
            IF v_sf_high = 0 AND sf_cnt[14] > 0 AND sf_cnt[2] > 0
               AND sf_cnt[3] > 0 AND sf_cnt[4] > 0 AND sf_cnt[5] > 0 THEN
                v_sf_high := 5;
            END IF;
        END;
    END IF;

    -- Score: higher = better
    IF v_sf_high > 0 THEN
        best := 8000 + v_sf_high;
    ELSIF v_quads_rank > 0 THEN
        best := 7000 + v_quads_rank * 15 + v_high_card;
    ELSIF v_trips_rank > 0 AND array_length(v_pairs, 1) >= 2 THEN
        -- Full house: trips + pair (pairs array includes the trips rank)
        DECLARE fh_pair INTEGER := 0;
        BEGIN
            FOR j IN 1..array_length(v_pairs, 1) LOOP
                IF v_pairs[j] != v_trips_rank AND v_pairs[j] > fh_pair THEN
                    fh_pair := v_pairs[j];
                END IF;
            END LOOP;
            IF fh_pair > 0 THEN
                best := 6000 + v_trips_rank * 15 + fh_pair;
            ELSE
                -- Only trips (the "pairs" were all the same rank as trips)
                best := 3000 + v_trips_rank * 15 + v_high_card;
            END IF;
        END;
    ELSIF v_flush_high > 0 THEN
        best := 5000 + v_flush_high;
    ELSIF v_straight_high > 0 THEN
        best := 4000 + v_straight_high;
    ELSIF v_trips_rank > 0 THEN
        best := 3000 + v_trips_rank * 15 + v_high_card;
    ELSIF array_length(v_pairs, 1) >= 2 THEN
        best := 2000 + v_pairs[1] * 15 + v_pairs[2];
    ELSIF array_length(v_pairs, 1) = 1 THEN
        best := 1000 + v_pairs[1] * 15 + v_high_card;
    ELSE
        best := v_high_card;
    END IF;

    -- Tiny random for tie-breaking (rare same-score hands)
    RETURN best + random() * 0.01;
END;
$$ LANGUAGE plpgsql;


-- ============ DEAL NEW HAND ============
-- Shuffles deck, deals hole cards, posts blinds, sets closer for round tracking
CREATE OR REPLACE FUNCTION public.pvp_deal()
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_deck TEXT[];
    v_seats JSONB;
    v_hand_num INTEGER;
    v_sb_seat INTEGER;
    v_bb_seat INTEGER;
    v_first_seat INTEGER;
    v_cards TEXT[];
    v_seat JSONB;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;
    v_seats := v_room.seats;
    IF jsonb_array_length(v_seats) < 6 THEN RETURN '{"error":"room not ready"}'::jsonb; END IF;

    -- Build and shuffle deck
    v_deck := ARRAY(
        SELECT r || s FROM
        unnest(ARRAY['2','3','4','5','6','7','8','9','T','J','Q','K','A']) AS r,
        unnest(ARRAY['c','d','h','s']) AS s
        ORDER BY random()
    );

    v_hand_num := v_room.hand_number + 1;

    -- Rotate dealer
    v_room.dealer_seat := (v_room.dealer_seat + 1) % 6;
    v_sb_seat := (v_room.dealer_seat + 1) % 6;
    v_bb_seat := (v_room.dealer_seat + 2) % 6;
    v_first_seat := (v_room.dealer_seat + 3) % 6;

    -- Deal 2 cards to each seat, save to pvp_hands
    DELETE FROM pvp_hands WHERE room_id = 1;
    FOR i IN 0..5 LOOP
        v_cards := ARRAY[v_deck[i*2 + 1], v_deck[i*2 + 2]];
        v_seat := v_seats->i;
        INSERT INTO pvp_hands (room_id, seat_idx, user_id, cards, hand_number)
        VALUES (1, i, (v_seat->>'user_id')::uuid, v_cards, v_hand_num);
    END LOOP;

    -- Remove dealt cards from deck (12 cards dealt)
    v_deck := v_deck[13:];

    -- Post blinds (deduct from stacks)
    v_seats := jsonb_set(v_seats, ARRAY[v_sb_seat::text, 'stack'],
        to_jsonb(GREATEST(0, (v_seats->v_sb_seat->>'stack')::real - 0.5)));
    v_seats := jsonb_set(v_seats, ARRAY[v_bb_seat::text, 'stack'],
        to_jsonb(GREATEST(0, (v_seats->v_bb_seat->>'stack')::real - 1)));

    UPDATE pvp_room SET
        deck = v_deck,
        board = '{}',
        pot = 1.5,
        street = 'preflop',
        current_bet = 1,
        bets = ARRAY[0,0,0,0,0,0]::real[],
        folded = ARRAY[false,false,false,false,false,false],
        all_in = ARRAY[false,false,false,false,false,false],
        dealer_seat = v_room.dealer_seat,
        acting_seat = v_first_seat,
        hand_number = v_hand_num,
        seats = v_seats,
        -- closer = BB seat (BB is last to act preflop if no raises)
        last_action = jsonb_build_object('closer', v_bb_seat),
        updated_at = NOW()
    WHERE id = 1;

    -- Set blind bets (separate update for array indexing)
    UPDATE pvp_room SET
        bets[v_sb_seat + 1] = 0.5,
        bets[v_bb_seat + 1] = 1
    WHERE id = 1;

    RETURN jsonb_build_object('ok', true, 'hand', v_hand_num);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============ MAIN ACTION PROCESSOR ============
-- Handles: action → round-complete check → street advance → showdown
-- Uses "closer" field to track when all players have had their turn
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
    v_can_act INTEGER;
    v_next INTEGER;
    v_closer INTEGER;
    v_all_matched BOOLEAN;
    v_is_raise BOOLEAN := false;
    v_advance BOOLEAN := false;
    i INTEGER;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;
    IF v_room.street = 'waiting' THEN RETURN '{"error":"no active hand"}'::jsonb; END IF;
    IF v_room.acting_seat != p_seat THEN RETURN '{"error":"not your turn"}'::jsonb; END IF;

    v_stack := (v_room.seats->p_seat->>'stack')::real;
    v_to_call := GREATEST(0, v_room.current_bet - v_room.bets[p_seat + 1]);
    v_closer := COALESCE((v_room.last_action->>'closer')::integer, -1);

    -- ===== PROCESS ACTION =====
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
            IF v_actual > 0 THEN
                v_room.pot := v_room.pot + v_actual;
                v_room.bets[p_seat + 1] := v_room.bets[p_seat + 1] + v_actual;
                v_room.current_bet := v_room.bets[p_seat + 1];
                v_stack := v_stack - v_actual;
                IF v_stack <= 0 THEN v_room.all_in[p_seat + 1] := true; END IF;
                v_is_raise := true;
            END IF;

        WHEN 'allin' THEN
            IF v_stack > 0 THEN
                v_room.pot := v_room.pot + v_stack;
                v_room.bets[p_seat + 1] := v_room.bets[p_seat + 1] + v_stack;
                IF v_room.bets[p_seat + 1] > v_room.current_bet THEN
                    v_room.current_bet := v_room.bets[p_seat + 1];
                    v_is_raise := true;
                END IF;
                v_stack := 0;
            END IF;
            v_room.all_in[p_seat + 1] := true;

        ELSE
            RETURN '{"error":"invalid action"}'::jsonb;
    END CASE;

    -- Update stack in seats JSON
    v_room.seats := jsonb_set(v_room.seats, ARRAY[p_seat::text, 'stack'], to_jsonb(v_stack));

    -- If this was a raise, update closer to last active seat before raiser
    IF v_is_raise THEN
        v_closer := pvp_prev_active_seat(p_seat, v_room.folded, v_room.all_in);
    END IF;

    -- Record action with closer
    v_room.last_action := jsonb_build_object(
        'seat', p_seat, 'action', p_action, 'amount', p_amount,
        'ts', extract(epoch from now()),
        'closer', v_closer
    );

    -- ===== CHECK GAME STATE =====

    -- Count active (non-folded) players
    v_active := pvp_active_count(v_room.folded);

    -- Only 1 player left → fold win
    IF v_active <= 1 THEN
        FOR i IN 0..5 LOOP
            IF NOT v_room.folded[i + 1] THEN
                v_room.seats := jsonb_set(v_room.seats, ARRAY[i::text, 'stack'],
                    to_jsonb(((v_room.seats->i->>'stack')::real) + v_room.pot));
                v_room.last_action := jsonb_build_object(
                    'winner', i, 'amount', v_room.pot,
                    'type', 'fold_win',
                    'ts', extract(epoch from now())
                );
                EXIT;
            END IF;
        END LOOP;
        UPDATE pvp_room SET seats=v_room.seats, pot=0, street='waiting',
            current_bet=0, bets='{0,0,0,0,0,0}', folded=v_room.folded, all_in=v_room.all_in,
            acting_seat=-1, last_action=v_room.last_action,
            board=v_room.board, deck=v_room.deck, updated_at=NOW() WHERE id=1;
        RETURN jsonb_build_object('ok', true, 'result', 'fold_win');
    END IF;

    -- Count players who can still bet (not folded, not all-in)
    v_can_act := 0;
    FOR i IN 1..6 LOOP
        IF NOT v_room.folded[i] AND NOT v_room.all_in[i] THEN v_can_act := v_can_act + 1; END IF;
    END LOOP;

    -- Check if all active non-allin bets match current bet
    v_all_matched := true;
    FOR i IN 1..6 LOOP
        IF NOT v_room.folded[i] AND NOT v_room.all_in[i] AND v_room.bets[i] < v_room.current_bet THEN
            v_all_matched := false;
            EXIT;
        END IF;
    END LOOP;

    -- ===== DETERMINE NEXT STATE =====

    IF v_can_act <= 1 AND v_all_matched THEN
        -- 0 or 1 players can still bet, all matched → run out board + showdown
        WHILE COALESCE(array_length(v_room.board, 1), 0) < 5 LOOP
            IF array_length(v_room.deck, 1) >= 2 THEN
                v_room.deck := v_room.deck[2:]; -- burn
                v_room.board := array_append(v_room.board, v_room.deck[1]);
                v_room.deck := v_room.deck[2:];
            ELSE
                EXIT; -- no more cards
            END IF;
        END LOOP;
        UPDATE pvp_room SET board=v_room.board, deck=v_room.deck,
            seats=v_room.seats, pot=v_room.pot, bets=v_room.bets,
            folded=v_room.folded, all_in=v_room.all_in,
            last_action=v_room.last_action, updated_at=NOW() WHERE id=1;
        PERFORM pvp_showdown();
        SELECT * INTO v_room FROM pvp_room WHERE id = 1;
        RETURN jsonb_build_object('ok', true, 'result', 'showdown',
            'winner', v_room.last_action->'winner',
            'board', array_to_json(v_room.board));

    ELSIF v_is_raise THEN
        -- Raise reopens action → continue to next player
        v_room.acting_seat := pvp_next_seat(p_seat, v_room.folded, v_room.all_in);

    ELSIF p_seat = v_closer AND v_all_matched THEN
        -- Closer has acted and all bets match → round complete → advance street
        v_advance := true;

    ELSE
        -- Round not done → next player
        v_room.acting_seat := pvp_next_seat(p_seat, v_room.folded, v_room.all_in);
    END IF;

    -- ===== ADVANCE STREET =====
    IF v_advance THEN
        v_room.bets := '{0,0,0,0,0,0}'::real[];
        v_room.current_bet := 0;

        IF v_room.street = 'preflop' THEN
            v_room.street := 'flop';
            -- Burn + deal 3
            IF array_length(v_room.deck, 1) >= 8 THEN
                v_room.deck := v_room.deck[2:]; -- burn
                v_room.board := array_append(v_room.board, v_room.deck[1]);
                v_room.deck := v_room.deck[2:];
                v_room.board := array_append(v_room.board, v_room.deck[1]);
                v_room.deck := v_room.deck[2:];
                v_room.board := array_append(v_room.board, v_room.deck[1]);
                v_room.deck := v_room.deck[2:];
            END IF;

        ELSIF v_room.street = 'flop' THEN
            v_room.street := 'turn';
            IF array_length(v_room.deck, 1) >= 2 THEN
                v_room.deck := v_room.deck[2:]; -- burn
                v_room.board := array_append(v_room.board, v_room.deck[1]);
                v_room.deck := v_room.deck[2:];
            END IF;

        ELSIF v_room.street = 'turn' THEN
            v_room.street := 'river';
            IF array_length(v_room.deck, 1) >= 2 THEN
                v_room.deck := v_room.deck[2:]; -- burn
                v_room.board := array_append(v_room.board, v_room.deck[1]);
                v_room.deck := v_room.deck[2:];
            END IF;

        ELSIF v_room.street = 'river' THEN
            -- Showdown
            UPDATE pvp_room SET seats=v_room.seats, pot=v_room.pot, deck=v_room.deck,
                bets='{0,0,0,0,0,0}', current_bet=0, folded=v_room.folded, all_in=v_room.all_in,
                last_action=v_room.last_action, board=v_room.board, updated_at=NOW() WHERE id=1;
            PERFORM pvp_showdown();
            SELECT * INTO v_room FROM pvp_room WHERE id = 1;
            RETURN jsonb_build_object('ok', true, 'result', 'showdown',
                'winner', v_room.last_action->'winner',
                'board', array_to_json(v_room.board));
        END IF;

        -- Set first-to-act for new street and new closer
        v_room.acting_seat := pvp_next_seat(v_room.dealer_seat, v_room.folded, v_room.all_in);
        IF v_room.acting_seat >= 0 THEN
            v_closer := pvp_prev_active_seat(v_room.acting_seat, v_room.folded, v_room.all_in);
        ELSE
            v_closer := -1;
        END IF;
        v_room.last_action := jsonb_build_object(
            'closer', v_closer,
            'street_changed', true,
            'ts', extract(epoch from now())
        );

        -- Re-check: if only 0-1 can act on new street → run out + showdown
        v_can_act := 0;
        FOR i IN 1..6 LOOP
            IF NOT v_room.folded[i] AND NOT v_room.all_in[i] THEN v_can_act := v_can_act + 1; END IF;
        END LOOP;
        IF v_can_act <= 1 THEN
            -- Run out remaining board
            WHILE COALESCE(array_length(v_room.board, 1), 0) < 5 LOOP
                IF array_length(v_room.deck, 1) >= 2 THEN
                    v_room.deck := v_room.deck[2:]; -- burn
                    v_room.board := array_append(v_room.board, v_room.deck[1]);
                    v_room.deck := v_room.deck[2:];
                ELSE EXIT;
                END IF;
            END LOOP;
            UPDATE pvp_room SET board=v_room.board, deck=v_room.deck,
                seats=v_room.seats, pot=v_room.pot, street='river',
                bets='{0,0,0,0,0,0}', current_bet=0, folded=v_room.folded, all_in=v_room.all_in,
                last_action=v_room.last_action, updated_at=NOW() WHERE id=1;
            PERFORM pvp_showdown();
            SELECT * INTO v_room FROM pvp_room WHERE id = 1;
            RETURN jsonb_build_object('ok', true, 'result', 'showdown',
                'winner', v_room.last_action->'winner',
                'board', array_to_json(v_room.board));
        END IF;
    END IF;

    -- ===== SAVE STATE =====
    UPDATE pvp_room SET
        seats = v_room.seats,
        pot = v_room.pot,
        street = v_room.street,
        deck = v_room.deck,
        current_bet = v_room.current_bet,
        bets = v_room.bets,
        folded = v_room.folded,
        all_in = v_room.all_in,
        acting_seat = v_room.acting_seat,
        last_action = v_room.last_action,
        board = v_room.board,
        updated_at = NOW()
    WHERE id = 1;

    RETURN jsonb_build_object('ok', true, 'street', v_room.street, 'acting', v_room.acting_seat);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============ SHOWDOWN ============
-- Evaluate hands, award pot to best hand, reset to waiting
CREATE OR REPLACE FUNCTION pvp_showdown()
RETURNS void AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_best_score REAL := -1;
    v_winner INTEGER := -1;
    v_score REAL;
    v_hand pvp_hands%ROWTYPE;
    i INTEGER;
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

    -- Record result and reset for next hand
    UPDATE pvp_room SET
        seats = v_room.seats,
        street = 'waiting',
        pot = 0,
        current_bet = 0,
        bets = '{0,0,0,0,0,0}',
        acting_seat = -1,
        last_action = jsonb_build_object(
            'winner', v_winner,
            'amount', v_room.pot,
            'type', 'showdown',
            'ts', extract(epoch from now())
        ),
        updated_at = NOW()
    WHERE id = 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============ PLAYER ACTION WRAPPER ============
-- Validates auth, finds player seat, calls pvp_do_action
CREATE OR REPLACE FUNCTION public.pvp_action(p_action TEXT, p_amount REAL DEFAULT 0)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_room pvp_room%ROWTYPE;
    v_seat INTEGER := -1;
    i INTEGER;
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


-- ============ BOT ACTION WRAPPER ============
-- Validates acting seat is a bot, calls pvp_do_action
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
    IF NOT v_is_bot THEN RETURN '{"error":"not a bot seat"}'::jsonb; END IF;

    RETURN pvp_do_action(v_seat, p_action, p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============ GRANTS ============
GRANT EXECUTE ON FUNCTION pvp_next_seat(INTEGER, BOOLEAN[], BOOLEAN[]) TO authenticated;
GRANT EXECUTE ON FUNCTION pvp_prev_active_seat(INTEGER, BOOLEAN[], BOOLEAN[]) TO authenticated;
GRANT EXECUTE ON FUNCTION pvp_active_count(BOOLEAN[]) TO authenticated;
GRANT EXECUTE ON FUNCTION pvp_eval_hand(TEXT[], TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_deal() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_do_action(INTEGER, TEXT, REAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_action(TEXT, REAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_bot_action(TEXT, REAL) TO authenticated;
GRANT EXECUTE ON FUNCTION pvp_showdown() TO authenticated;

-- ============ RESET ROOM FOR FRESH START ============
UPDATE pvp_room SET
    street = 'waiting',
    hand_number = 0,
    acting_seat = -1,
    pot = 0,
    current_bet = 0,
    bets = '{0,0,0,0,0,0}',
    folded = '{f,f,f,f,f,f}',
    all_in = '{f,f,f,f,f,f}',
    board = '{}',
    deck = '{}',
    last_action = '{}',
    dealer_seat = 0
WHERE id = 1;
-- Keep seats as-is (preserve player/bot assignments)
DELETE FROM pvp_hands WHERE room_id = 1;
