-- Eigen databaserol voor de app (P7.4): de app verbindt als `avanta_app` in plaats van als de beheerder `avanta`
-- (superuser, POSTGRES_USER van de databasecontainer). `avanta_app` is eigenaar van de database, het schema `public`
-- en alles daarin, zodat de migraties bij het starten gewoon blijven werken, maar mag geen rollen of databases
-- aanmaken, geen superuser-functies gebruiken en niets buiten deze database.
--
-- Herhaalbaar: install.sh draait dit bij elke installatie en update, als `avanta`, vóór de app start. Het wachtwoord
-- komt niet op de opdrachtregel maar via stdin vooraf:
--   SELECT set_config('avanta.app_password', '<APP_DB_PASSWORD>', false);
-- Wat bestaat blijft bestaan; alleen eigenaar, rechten en wachtwoord worden gelijkgetrokken.
-- Test: app/test/app-role.test.js.

DO $rol$
DECLARE
  -- Rolnaam: altijd avanta_app; alleen de test geeft een eigen naam mee (avanta.app_role), omdat rollen clusterbreed zijn.
  app_role text := coalesce(nullif(current_setting('avanta.app_role', true), ''), 'avanta_app');
  app_password text := current_setting('avanta.app_password', true);
  item record;
BEGIN
  IF app_role !~ '^avanta_app[a-z0-9_]{0,40}$' THEN
    RAISE EXCEPTION 'avanta.app_role moet met avanta_app beginnen (kleine letters, cijfers, _)';
  END IF;
  IF app_password IS NULL OR app_password !~ '^[0-9a-f]{32,}$' THEN
    RAISE EXCEPTION 'avanta.app_password ontbreekt of is geen hex-tekst van minstens 32 tekens';
  END IF;

  -- De rol: alleen inloggen, verder niets. Bestaat hij al, dan worden de kenmerken en het wachtwoord gelijkgetrokken.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    EXECUTE format('CREATE ROLE %I LOGIN', app_role);
  END IF;
  EXECUTE format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT '
    'CONNECTION LIMIT 50 PASSWORD %L', app_role, app_password);
  -- Geen lidmaatschap van andere rollen (zoals pg_read_server_files of de beheerder).
  FOR item IN
    SELECT parent.rolname FROM pg_auth_members member JOIN pg_roles parent ON parent.oid = member.roleid
    WHERE member.member = (SELECT oid FROM pg_roles WHERE rolname = app_role)
  LOOP
    EXECUTE format('REVOKE %I FROM %I', item.rolname, app_role);
  END LOOP;

  -- Database en schema: van de app; anderen mogen er niet in (behalve superusers).
  EXECUTE format('ALTER DATABASE %I OWNER TO %I', current_database(), app_role);
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('ALTER SCHEMA public OWNER TO %I', app_role);
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;

  -- Bestaande objecten in public (van vóór deze rol, aangemaakt als `avanta`) overdragen. Eerst tabellen: een reeks die
  -- bij een kolom hoort gaat dan vanzelf mee; daarna wat nog over is.
  FOR item IN
    SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = app_role)
    ORDER BY c.relkind, c.relname
  LOOP
    EXECUTE format('ALTER %s public.%I OWNER TO %I',
      CASE item.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,
      item.relname, app_role);
  END LOOP;
  FOR item IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = app_role)
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', item.relname, app_role);
  END LOOP;
  FOR item IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proowner <> (SELECT oid FROM pg_roles WHERE rolname = app_role)
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER ROUTINE public.%I(%s) OWNER TO %I', item.proname, item.args, app_role);
  END LOOP;
  -- Losse typen (enum, domein, samengesteld); de rijtypen van tabellen gaan met hun tabel mee.
  FOR item IN
    SELECT t.typname, t.typtype FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd', 'c', 'r') AND t.typowner <> (SELECT oid FROM pg_roles WHERE rolname = app_role)
      AND (t.typrelid = 0 OR (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s public.%I OWNER TO %I', CASE item.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, item.typname, app_role);
  END LOOP;
END
$rol$;
