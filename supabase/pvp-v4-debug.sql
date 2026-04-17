-- Diagnostic: a pvp_deal_debug function that returns what happens step-by-step
-- Run this in Supabase SQL Editor, then I'll call it to see the issue
CREATE OR REPLACE FUNCTION public.pvp_deal_debug()
RETURNS JSONB AS $$
DECLARE
    v_room pvp_room%ROWTYPE;
    v_seats JSONB;
    v_changes JSONB;
    v_change JSONB;
    v_sits_map JSONB := '{}'::jsonb;
    v_new_seats JSONB;
    v_s JSONB;
    v_now REAL := extract(epoch from now());
    i INTEGER;
    v_debug JSONB := jsonb_build_object();
BEGIN
    SELECT * INTO v_room FROM pvp_room WHERE id = 1;
    v_seats := v_room.seats;
    v_changes := COALESCE(v_room.pending_changes, '[]'::jsonb);

    v_debug := v_debug || jsonb_build_object(
        'street', v_room.street,
        'hand_number', v_room.hand_number,
        'v_changes_len', jsonb_array_length(v_changes),
        'v_changes', v_changes,
        'seats_type', jsonb_typeof(v_seats),
        'seats_len', CASE WHEN jsonb_typeof(v_seats) = 'array' THEN jsonb_array_length(v_seats) ELSE -1 END,
        'seat_2_before', v_seats->2
    );

    -- Build sits_map
    IF jsonb_array_length(v_changes) > 0 THEN
        FOR i IN 0..jsonb_array_length(v_changes)-1 LOOP
            v_change := v_changes->i;
            IF (v_change->>'action') = 'sit' THEN
                v_sits_map := jsonb_set(v_sits_map, ARRAY[v_change->>'seat'], v_change);
            END IF;
        END LOOP;
    END IF;
    v_debug := v_debug || jsonb_build_object('sits_map', v_sits_map);

    -- Try to apply one sit (for seat 2)
    IF v_sits_map ? '2' THEN
        v_change := v_sits_map->'2';
        v_s := v_seats->2;
        v_debug := v_debug || jsonb_build_object(
            'seat_2_type', v_s->>'type',
            'can_apply', (v_s->>'type') = 'bot'
        );

        IF (v_s->>'type') = 'bot' THEN
            v_s := jsonb_build_object(
                'user_id', (v_change->>'user_id')::uuid,
                'name', v_change->>'name',
                'stack', (v_change->>'stack')::real,
                'seat_idx', 2,
                'type', 'human',
                'is_bot', false,
                'last_seen', v_now
            );
            v_debug := v_debug || jsonb_build_object('new_seat_2', v_s);

            -- Try the array rebuild
            v_new_seats := '[]'::jsonb;
            FOR i IN 0..5 LOOP
                IF i = 2 THEN
                    v_new_seats := v_new_seats || v_s;
                ELSE
                    v_new_seats := v_new_seats || (v_seats->i);
                END IF;
            END LOOP;
            v_debug := v_debug || jsonb_build_object('new_seats_2', v_new_seats->2);
        END IF;
    END IF;

    RETURN v_debug;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.pvp_deal_debug() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_deal_debug() TO service_role;
