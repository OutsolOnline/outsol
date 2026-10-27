-- Legacy Supabase lockdown. Run once in the original Supabase SQL editor.
-- This preserves existing rows for controlled recovery; the application no longer uses these tables.
-- Rotate the previously committed service-role credential separately in Supabase.
DO $$
DECLARE table_name text;
DECLARE policy_record record;
DECLARE function_record record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['VaniteWallets', 'VaniteLaunches'] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
      FOR policy_record IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', policy_record.policyname, table_name);
      END LOOP;
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
    END IF;
  END LOOP;
  -- Remove public execution of any old raw-SQL helper, if one was installed.
  FOR function_record IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'exec_sql'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', function_record.proname, function_record.arguments);
  END LOOP;
END $$;
