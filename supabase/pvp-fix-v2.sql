-- ============================================================
-- PVP Fix v2 — fix stuck games + expose bot hands for better AI
-- Run in Supabase SQL Editor
-- ============================================================

-- FIX 1: Allow reading bot hole cards (user_id IS NULL)
-- This lets the host's browser run proper BotAI.decide() with hand eval
DROP POLICY IF EXISTS "Bot hands visible" ON public.pvp_hands;
CREATE POLICY "Bot hands visible" ON public.pvp_hands
    FOR SELECT USING (user_id IS NULL);

-- FIX 2: Update pvp_deal to mark 0-stack seats as folded (sitting out)
-- Prevents stuck games when bots/players have 0 chips from prior hands
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
    v_folded BOOLEAN[];
    v_stack REAL;
    v_active_count INTEGER := 0;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;
    v_seats := v_room.seats;
    IF jsonb_array_length(v_seats) < 6 THEN RETURN '{"error":"room not ready"}'::jsonb; END IF;

    -- Re-seed bots with 100BB if they're bankrupt (keeps the game going)
    FOR i IN 0..5 LOOP
        v_seat := v_seats->i;
        v_stack := (v_seat->>'stack')::real;
        IF (v_seat->>'is_bot')::boolean AND v_stack <= 0 THEN
            v_seats := jsonb_set(v_seats, ARRAY[i::text, 'stack'], to_jsonb(100.0));
        END IF;
    END LOOP;

    -- Initialize folded: any seat with stack <= 0 sits out this hand
    v_folded := ARRAY[false, false, false, false, false, false];
    FOR i IN 0..5 LOOP
        v_seat := v_seats->i;
        v_stack := (v_seat->>'stack')::real;
        IF v_stack <= 0 THEN
            v_folded[i + 1] := true;
        ELSE
            v_active_count := v_active_count + 1;
        END IF;
    END LOOP;

    IF v_active_count < 2 THEN
        RETURN '{"error":"need at least 2 players with chips"}'::jsonb;
    END IF;

    -- Build and shuffle deck
    v_deck := ARRAY(
        SELECT r || s FROM
        unnest(ARRAY['2','3','4','5','6','7','8','9','T','J','Q','K','A']) AS r,
        unnest(ARRAY['c','d','h','s']) AS s
        ORDER BY random()
    );

    v_hand_num := v_room.hand_number + 1;

    -- Rotate dealer — skip seats that are folded (sitting out)
    v_room.dealer_seat := (v_room.dealer_seat + 1) % 6;
    FOR i IN 0..5 LOOP
        IF NOT v_folded[v_room.dealer_seat + 1] THEN EXIT; END IF;
        v_room.dealer_seat := (v_room.dealer_seat + 1) % 6;
    END LOOP;

    -- Find SB (next active after dealer)
    v_sb_seat := v_room.dealer_seat;
    FOR i IN 1..6 LOOP
        v_sb_seat := (v_sb_seat + 1) % 6;
        IF NOT v_folded[v_sb_seat + 1] THEN EXIT; END IF;
    END LOOP;

    -- Find BB (next active after SB)
    v_bb_seat := v_sb_seat;
    FOR i IN 1..6 LOOP
        v_bb_seat := (v_bb_seat + 1) % 6;
        IF NOT v_folded[v_bb_seat + 1] THEN EXIT; END IF;
    END LOOP;

    -- Find first to act (next active after BB)
    v_first_seat := v_bb_seat;
    FOR i IN 1..6 LOOP
        v_first_seat := (v_first_seat + 1) % 6;
        IF NOT v_folded[v_first_seat + 1] THEN EXIT; END IF;
    END LOOP;

    -- Deal 2 cards to each ACTIVE seat only (sitting-out seats get empty)
    DELETE FROM pvp_hands WHERE room_id = 1;
    FOR i IN 0..5 LOOP
        IF NOT v_folded[i + 1] THEN
            v_cards := ARRAY[v_deck[i*2 + 1], v_deck[i*2 + 2]];
        ELSE
            v_cards := ARRAY[]::TEXT[];
        END IF;
        v_seat := v_seats->i;
        INSERT INTO pvp_hands (room_id, seat_idx, user_id, cards, hand_number)
        VALUES (1, i, (v_seat->>'user_id')::uuid, v_cards, v_hand_num);
    END LOOP;

    -- Remove dealt cards from deck (12 cards max)
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
        folded = v_folded,
        all_in = ARRAY[false,false,false,false,false,false],
        dealer_seat = v_room.dealer_seat,
        acting_seat = v_first_seat,
        hand_number = v_hand_num,
        seats = v_seats,
        last_action = jsonb_build_object('closer', v_bb_seat),
        updated_at = NOW()
    WHERE id = 1;

    UPDATE pvp_room SET
        bets[v_sb_seat + 1] = 0.5,
        bets[v_bb_seat + 1] = 1
    WHERE id = 1;

    RETURN jsonb_build_object('ok', true, 'hand', v_hand_num);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.pvp_deal() TO authenticated;
