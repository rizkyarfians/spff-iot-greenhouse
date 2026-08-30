BEGIN;

CREATE OR REPLACE FUNCTION spff.delete_app_user(
  p_target_user_id text,
  p_actor_user_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, spff
AS $$
DECLARE
  target_role text;
  target_enabled boolean;
  target_username text;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('spff.app_users.admin_guard')
  );

  IF p_target_user_id = p_actor_user_id THEN
    RAISE EXCEPTION 'SELF_DELETE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM spff.app_users
    WHERE user_id = p_actor_user_id
      AND role = 'admin'
      AND enabled = true
  ) THEN
    RAISE EXCEPTION 'DELETE_USER_FORBIDDEN';
  END IF;

  SELECT
    role,
    enabled,
    username
  INTO
    target_role,
    target_enabled,
    target_username
  FROM spff.app_users
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF target_role = 'admin'
    AND target_enabled
    AND NOT EXISTS (
      SELECT 1
      FROM spff.app_users
      WHERE role = 'admin'
        AND enabled = true
        AND user_id <> p_target_user_id
    )
  THEN
    RAISE EXCEPTION 'LAST_ADMIN';
  END IF;

  DELETE FROM spff.app_users
  WHERE user_id = p_target_user_id;

  RETURN target_username;
END;
$$;

REVOKE ALL
ON FUNCTION spff.delete_app_user(text, text)
FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['spff_app', 'spff_api_role']
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = role_name
    ) THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION spff.delete_app_user(text, text) TO %I',
        role_name
      );
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION spff.delete_app_user(text, text) IS
  'Safely deletes a non-current dashboard account while preserving at least one active admin.';

COMMIT;
