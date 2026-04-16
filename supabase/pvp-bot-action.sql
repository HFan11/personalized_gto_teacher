-- ============================================================
-- Bot action function: any authenticated user can trigger bot
-- Only works if the acting seat IS a bot
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION public.pvp_bot_action(p_action TEXT, p_amount REAL DEFAULT 0)
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_seat_idx INTEGER;
    v_seat JSONB;
    v_to_call REAL;
    v_stack REAL;
    v_actual REAL;
    v_is_bot BOOLEAN;
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1 FOR UPDATE;

    v_seat_idx := v_room.acting_seat;
    IF v_seat_idx < 0 OR v_seat_idx > 5 THEN RETURN '{"error":"no acting seat"}'::jsonb; END IF;

    v_seat := v_room.seats->v_seat_idx;
    v_is_bot := COALESCE((v_seat->>'is_bot')::boolean, false);
    IF NOT v_is_bot THEN RETURN '{"error":"not a bot seat"}'::jsonb; END IF;

    v_stack := (v_seat->>'stack')::real;
    v_to_call := v_room.current_bet - v_room.bets[v_seat_idx + 1];

    CASE p_action
        WHEN 'fold' THEN
            v_room.folded[v_seat_idx + 1] := true;
        WHEN 'check' THEN
            NULL;
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

    v_room.seats := jsonb_set(v_room.seats, ARRAY[v_seat_idx::text, 'stack'], to_jsonb(v_stack));
    v_room.last_action := jsonb_build_object(
        'seat', v_seat_idx, 'action', p_action, 'amount', p_amount,
        'ts', extract(epoch from now())
    );

    -- Advance to next non-folded, non-allin seat
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
        seats = v_room.seats, pot = v_room.pot, current_bet = v_room.current_bet,
        bets = v_room.bets, folded = v_room.folded, all_in = v_room.all_in,
        acting_seat = v_room.acting_seat, last_action = v_room.last_action,
        updated_at = NOW()
    WHERE id = 1;

    RETURN jsonb_build_object('ok', true, 'acting', v_room.acting_seat);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.pvp_bot_action(TEXT, REAL) TO authenticated;
