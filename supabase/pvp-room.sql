-- ============================================================
-- PVP Room: Server-side game logic via PostgreSQL functions
-- Run this in Supabase SQL Editor
-- ============================================================

-- Room state (single room)
CREATE TABLE IF NOT EXISTS public.pvp_room (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- single room
    seats JSONB DEFAULT '[]'::jsonb,          -- [{user_id, name, stack, seat_idx, is_bot}]
    deck TEXT[] DEFAULT '{}',                  -- remaining deck cards
    board TEXT[] DEFAULT '{}',                 -- community cards
    pot REAL DEFAULT 0,
    street TEXT DEFAULT 'waiting',             -- waiting, preflop, flop, turn, river, showdown
    current_bet REAL DEFAULT 0,
    bets REAL[] DEFAULT '{0,0,0,0,0,0}',
    folded BOOLEAN[] DEFAULT '{f,f,f,f,f,f}',
    all_in BOOLEAN[] DEFAULT '{f,f,f,f,f,f}',
    dealer_seat INTEGER DEFAULT 0,
    acting_seat INTEGER DEFAULT -1,
    hand_number INTEGER DEFAULT 0,
    last_action JSONB DEFAULT '{}'::jsonb,     -- {seat, action, amount, ts}
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Private hands (each player can only see their own)
CREATE TABLE IF NOT EXISTS public.pvp_hands (
    room_id INTEGER DEFAULT 1 REFERENCES public.pvp_room(id),
    seat_idx INTEGER NOT NULL,
    user_id UUID,
    cards TEXT[] DEFAULT '{}',    -- ["As", "Kd"]
    hand_number INTEGER NOT NULL,
    PRIMARY KEY (room_id, seat_idx, hand_number)
);

-- RLS: players can only see their own hand
ALTER TABLE public.pvp_hands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Players see own hand" ON public.pvp_hands
    FOR SELECT USING (auth.uid() = user_id);

-- Room is readable by all authenticated users
ALTER TABLE public.pvp_room ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Room readable by all" ON public.pvp_room
    FOR SELECT USING (true);
-- Only server functions can modify room (SECURITY DEFINER)
CREATE POLICY "Room updatable by functions" ON public.pvp_room
    FOR ALL USING (true);

-- Enable realtime on room
ALTER PUBLICATION supabase_realtime ADD TABLE public.pvp_room;

-- Initialize room if not exists
INSERT INTO public.pvp_room (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================
-- Server function: Join room
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_join(p_seat INTEGER)
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_seats JSONB;
    v_user_id UUID := auth.uid();
    v_name TEXT;
    v_seat JSONB;
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
            RETURN jsonb_build_object('ok', true, 'seat', i, 'msg', 'already seated');
        END IF;
    END LOOP;

    -- Check seat available (must be bot)
    v_seat := v_seats->p_seat;
    IF v_seat IS NULL OR (v_seat->>'is_bot')::boolean IS NOT TRUE THEN
        RETURN '{"error":"seat taken"}'::jsonb;
    END IF;

    -- Replace bot with player
    v_seats := jsonb_set(v_seats, ARRAY[p_seat::text], jsonb_build_object(
        'user_id', v_user_id, 'name', v_name, 'stack', 100,
        'seat_idx', p_seat, 'is_bot', false
    ));

    UPDATE pvp_room SET seats = v_seats, updated_at = NOW() WHERE id = 1;
    RETURN jsonb_build_object('ok', true, 'seat', p_seat);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Server function: Leave room
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_leave()
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_seats JSONB;
    v_seat JSONB;
BEGIN
    IF v_user_id IS NULL THEN RETURN '{"error":"not authenticated"}'::jsonb; END IF;

    SELECT seats INTO v_seats FROM pvp_room WHERE id = 1 FOR UPDATE;

    FOR i IN 0..5 LOOP
        v_seat := v_seats->i;
        IF v_seat->>'user_id' = v_user_id::text THEN
            -- Replace with bot
            v_seats := jsonb_set(v_seats, ARRAY[i::text], jsonb_build_object(
                'user_id', NULL, 'name', 'Bot ' || (i+1), 'stack', 100,
                'seat_idx', i, 'is_bot', true
            ));
            UPDATE pvp_room SET seats = v_seats, updated_at = NOW() WHERE id = 1;
            RETURN jsonb_build_object('ok', true);
        END IF;
    END LOOP;

    RETURN '{"error":"not in room"}'::jsonb;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Server function: Deal new hand
-- Shuffles deck, deals hole cards, posts blinds
-- ============================================================
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

    -- Post blinds
    v_seats := jsonb_set(v_seats, ARRAY[v_sb_seat::text, 'stack'],
        to_jsonb(((v_seats->v_sb_seat->>'stack')::real - 0.5)));
    v_seats := jsonb_set(v_seats, ARRAY[v_bb_seat::text, 'stack'],
        to_jsonb(((v_seats->v_bb_seat->>'stack')::real - 1)));

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
        last_action = '{}'::jsonb,
        updated_at = NOW()
    WHERE id = 1;

    -- Set blind bets
    UPDATE pvp_room SET
        bets[v_sb_seat + 1] = 0.5,
        bets[v_bb_seat + 1] = 1
    WHERE id = 1;

    RETURN jsonb_build_object('ok', true, 'hand', v_hand_num);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Server function: Player action (fold/check/call/raise/allin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.pvp_action(p_action TEXT, p_amount REAL DEFAULT 0)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_room pvp_room%ROWTYPE;
    v_seat_idx INTEGER := -1;
    v_seat JSONB;
    v_to_call REAL;
    v_stack REAL;
    v_actual REAL;
BEGIN
    IF v_user_id IS NULL THEN RETURN '{"error":"not authenticated"}'::jsonb; END IF;

    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;

    -- Find player's seat
    FOR i IN 0..5 LOOP
        IF (v_room.seats->i->>'user_id') = v_user_id::text THEN
            v_seat_idx := i;
            EXIT;
        END IF;
    END LOOP;

    IF v_seat_idx < 0 THEN RETURN '{"error":"not in room"}'::jsonb; END IF;
    IF v_seat_idx != v_room.acting_seat THEN RETURN '{"error":"not your turn"}'::jsonb; END IF;

    v_stack := (v_room.seats->v_seat_idx->>'stack')::real;
    v_to_call := v_room.current_bet - v_room.bets[v_seat_idx + 1];

    -- Process action
    CASE p_action
        WHEN 'fold' THEN
            v_room.folded[v_seat_idx + 1] := true;

        WHEN 'check' THEN
            NULL; -- nothing to do

        WHEN 'call' THEN
            v_actual := LEAST(v_to_call, v_stack);
            v_room.bets[v_seat_idx + 1] := v_room.bets[v_seat_idx + 1] + v_actual;
            v_room.pot := v_room.pot + v_actual;
            v_stack := v_stack - v_actual;
            IF v_stack <= 0 THEN v_room.all_in[v_seat_idx + 1] := true; END IF;

        WHEN 'raise', 'bet' THEN
            v_actual := LEAST(p_amount - v_room.bets[v_seat_idx + 1], v_stack);
            v_room.pot := v_room.pot + v_actual;
            v_room.bets[v_seat_idx + 1] := v_room.bets[v_seat_idx + 1] + v_actual;
            v_room.current_bet := v_room.bets[v_seat_idx + 1];
            v_stack := v_stack - v_actual;
            IF v_stack <= 0 THEN v_room.all_in[v_seat_idx + 1] := true; END IF;

        WHEN 'allin' THEN
            v_room.pot := v_room.pot + v_stack;
            v_room.bets[v_seat_idx + 1] := v_room.bets[v_seat_idx + 1] + v_stack;
            IF v_room.bets[v_seat_idx + 1] > v_room.current_bet THEN
                v_room.current_bet := v_room.bets[v_seat_idx + 1];
            END IF;
            v_stack := 0;
            v_room.all_in[v_seat_idx + 1] := true;

        ELSE
            RETURN '{"error":"invalid action"}'::jsonb;
    END CASE;

    -- Update stack
    v_room.seats := jsonb_set(v_room.seats, ARRAY[v_seat_idx::text, 'stack'], to_jsonb(v_stack));

    -- Record action
    v_room.last_action := jsonb_build_object(
        'seat', v_seat_idx, 'action', p_action, 'amount', p_amount,
        'ts', extract(epoch from now())
    );

    -- Advance to next actor (simplified — find next non-folded, non-allin seat)
    v_room.acting_seat := -1;
    FOR i IN 1..6 LOOP
        DECLARE v_next INTEGER := (v_seat_idx + i) % 6;
        BEGIN
            IF NOT v_room.folded[v_next + 1] AND NOT v_room.all_in[v_next + 1] THEN
                v_room.acting_seat := v_next;
                EXIT;
            END IF;
        END;
    END LOOP;

    UPDATE pvp_room SET
        seats = v_room.seats,
        pot = v_room.pot,
        current_bet = v_room.current_bet,
        bets = v_room.bets,
        folded = v_room.folded,
        all_in = v_room.all_in,
        acting_seat = v_room.acting_seat,
        last_action = v_room.last_action,
        updated_at = NOW()
    WHERE id = 1;

    RETURN jsonb_build_object('ok', true, 'acting', v_room.acting_seat);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.pvp_join(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_leave() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_deal() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_action(TEXT, REAL) TO authenticated;

-- Allow inserting/reading pvp_hands for the functions
GRANT ALL ON public.pvp_hands TO authenticated;
GRANT ALL ON public.pvp_room TO authenticated;
