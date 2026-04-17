-- Diagnostic: return the source code of a deployed function
CREATE OR REPLACE FUNCTION public.pvp_inspect(p_name TEXT)
RETURNS TEXT AS $$
    SELECT prosrc FROM pg_proc WHERE proname = p_name LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.pvp_inspect(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_inspect(TEXT) TO service_role;
