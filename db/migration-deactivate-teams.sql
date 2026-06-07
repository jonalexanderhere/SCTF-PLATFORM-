-- =============================================================
-- MIGRATION: Team Deactivation and Score Holding
-- =============================================================

-- 1. Alter Schema
ALTER TABLE public.teams 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS deactivation_message TEXT DEFAULT NULL;

-- 2. Create admin_toggle_team_active RPC function
CREATE OR REPLACE FUNCTION admin_toggle_team_active(
  p_team_id UUID, 
  p_is_active BOOLEAN, 
  p_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admin can toggle team active status';
  END IF;

  UPDATE public.teams
  SET is_active = p_is_active,
      deactivation_message = CASE WHEN p_is_active THEN NULL ELSE p_message END,
      updated_at = now()
  WHERE id = p_team_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION admin_toggle_team_active(UUID, BOOLEAN, TEXT) TO authenticated;

-- 3. Update admin_get_all_teams
CREATE OR REPLACE FUNCTION admin_get_all_teams()
RETURNS JSON AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admin can access this function';
  END IF;

  RETURN (
    SELECT json_agg(
      json_build_object(
        'id', t.id,
        'name', t.name,
        'invite_code', t.invite_code,
        'captain_user_id', t.captain_user_id,
        'created_at', t.created_at,
        'is_active', t.is_active,
        'deactivation_message', t.deactivation_message,
        'member_count', (SELECT count(*) FROM public.team_members tm WHERE tm.team_id = t.id),
        'member_names', (
          SELECT json_agg(u.username)
          FROM public.team_members tm
          JOIN public.users u ON u.id = tm.user_id
          WHERE tm.team_id = t.id
        ),
        'members', (
          SELECT COALESCE(
            json_agg(
              json_build_object(
                'id', u.id,
                'username', u.username,
                'is_captain', (u.id = t.captain_user_id)
              )
              ORDER BY (u.id = t.captain_user_id) DESC, tm.joined_at ASC
            ),
            '[]'::json
          )
          FROM public.team_members tm
          JOIN public.users u ON u.id = tm.user_id
          WHERE tm.team_id = t.id
        )
      )
      ORDER BY t.created_at DESC
    )
    FROM public.teams t
  );
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION admin_get_all_teams() TO authenticated;

-- 4. Update get_team_by_name
CREATE OR REPLACE FUNCTION get_team_by_name(
  p_name TEXT,
  p_event_id uuid DEFAULT NULL,
  p_event_mode text DEFAULT 'any'
)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid()::uuid;
  v_team_id UUID;
  v_team JSON;
  v_members JSON;
  v_unique_score BIGINT := 0;
  v_total_score BIGINT := 0;
  v_unique_challenges INT := 0;
  v_total_solves BIGINT := 0;
  v_can_view_invite BOOLEAN := FALSE;
  v_solved_event_ids UUID[];
  v_has_main_solved BOOLEAN := FALSE;
BEGIN
  -- ambil team id
  SELECT id INTO v_team_id
  FROM public.teams
  WHERE lower(name) = lower(p_name)
  LIMIT 1;

  IF v_team_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Team not found');
  END IF;

  -- cek akses invite
  IF v_user_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.team_members
      WHERE team_id = v_team_id AND user_id = v_user_id
    ) OR is_admin()
    INTO v_can_view_invite;
  END IF;

  -- info team
  SELECT json_build_object(
    'id', t.id,
    'name', t.name,
    'invite_code', CASE WHEN v_can_view_invite THEN t.invite_code ELSE NULL END,
    'created_at', t.created_at,
    'is_active', t.is_active,
    'deactivation_message', t.deactivation_message
  )
  INTO v_team
  FROM public.teams t
  WHERE t.id = v_team_id;

  -- ambil solved event ids
  SELECT COALESCE(
    array_agg(DISTINCT c.event_id) FILTER (WHERE c.event_id IS NOT NULL),
    '{}'::uuid[]
  ),
  COALESCE(bool_or(c.event_id IS NULL), FALSE)
  INTO v_solved_event_ids, v_has_main_solved
  FROM public.solves s
  JOIN public.challenges c ON c.id = s.challenge_id
  JOIN public.team_members tm ON tm.user_id = s.user_id
  WHERE tm.team_id = v_team_id;

  -- members + stats per user
  WITH team_users AS (
    SELECT tm.user_id, tm.joined_at
    FROM public.team_members tm
    WHERE tm.team_id = v_team_id
  ), team_first AS (
    SELECT DISTINCT ON (s.challenge_id)
      s.challenge_id,
      s.user_id,
      s.created_at
    FROM public.solves s
    JOIN team_users tu ON tu.user_id = s.user_id
    JOIN public.challenges c ON c.id = s.challenge_id
    WHERE (
      p_event_mode = 'any'
      OR (p_event_mode = 'main' AND c.event_id IS NULL)
      OR (p_event_id IS NOT NULL AND c.event_id = p_event_id)
    )
    ORDER BY s.challenge_id, s.created_at ASC, s.id ASC
  ), user_stats AS (
    SELECT
      tu.user_id,
      COALESCE(SUM(c.points), 0) AS solo_score
    FROM team_users tu
    LEFT JOIN public.solves s ON s.user_id = tu.user_id
    LEFT JOIN public.challenges c ON c.id = s.challenge_id
      AND (
        p_event_mode = 'any'
        OR (p_event_mode = 'main' AND c.event_id IS NULL)
        OR (p_event_id IS NOT NULL AND c.event_id = p_event_id)
      )
    GROUP BY tu.user_id
  ), first_stats AS (
    SELECT
      tf.user_id,
      COALESCE(COUNT(*), 0) AS first_solves,
      COALESCE(SUM(c.points), 0) AS first_solve_score
    FROM team_first tf
    JOIN public.challenges c ON c.id = tf.challenge_id
    GROUP BY tf.user_id
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'user_id', u.id,
        'username', u.username,
        'role', CASE WHEN u.id = t.captain_user_id THEN 'captain' ELSE 'member' END,
        'joined_at', tm.joined_at,
        'solo_score', COALESCE(us.solo_score, 0),
        'first_solve_count', COALESCE(fs.first_solves, 0),
        'first_solve_score', COALESCE(fs.first_solve_score, 0)
      )
      ORDER BY (u.id = t.captain_user_id) DESC, tm.joined_at ASC
    ),
    '[]'::json
  )
  INTO v_members
  FROM public.team_members tm
  JOIN public.users u ON u.id = tm.user_id
  JOIN public.teams t ON t.id = tm.team_id
  LEFT JOIN user_stats us ON us.user_id = tm.user_id
  LEFT JOIN first_stats fs ON fs.user_id = tm.user_id
  WHERE tm.team_id = v_team_id;

  -- stats team
  WITH team_users AS (
    SELECT user_id FROM public.team_members WHERE team_id = v_team_id
  ), solves_filtered AS (
    SELECT s.challenge_id, c.points
    FROM public.solves s
    JOIN team_users tu ON tu.user_id = s.user_id
    JOIN public.challenges c ON c.id = s.challenge_id
    WHERE (
      p_event_mode = 'any'
      OR (p_event_mode = 'main' AND c.event_id IS NULL)
      OR (p_event_id IS NOT NULL AND c.event_id = p_event_id)
    )
  ), unique_calc AS (
    SELECT
      COALESCE(SUM(t.points), 0)::BIGINT AS unique_score,
      COALESCE(COUNT(*), 0)::INT AS unique_challenges
    FROM (
      SELECT sf.challenge_id, MAX(sf.points) AS points
      FROM solves_filtered sf
      GROUP BY sf.challenge_id
    ) t
  ), totals AS (
    SELECT
      COALESCE(SUM(sf.points), 0)::BIGINT AS total_score,
      COALESCE(COUNT(*), 0)::BIGINT AS total_solves
    FROM solves_filtered sf
  )
  SELECT
    uc.unique_score,
    t.total_score,
    uc.unique_challenges,
    t.total_solves
  INTO v_unique_score, v_total_score, v_unique_challenges, v_total_solves
  FROM unique_calc uc
  CROSS JOIN totals t;

  RETURN json_build_object(
    'success', true,
    'team', v_team,
    'members', v_members,
    'solved_event_ids', v_solved_event_ids,
    'has_main_solved', v_has_main_solved,
    'stats', json_build_object(
      'unique_score', v_unique_score,
      'total_score', v_total_score,
      'unique_challenges', v_unique_challenges,
      'total_solves', v_total_solves
    )
  );
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION get_team_by_name(TEXT, uuid, text) TO authenticated;

-- 5. Update get_team_by_user_id
CREATE OR REPLACE FUNCTION get_team_by_user_id(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  v_team_id UUID;
  v_team JSON;
  v_members JSON;
  v_solved_event_ids UUID[];
  v_has_main_solved BOOLEAN := FALSE;
BEGIN
  SELECT team_id INTO v_team_id
  FROM public.team_members
  WHERE user_id = p_user_id;

  IF v_team_id IS NULL THEN
    RETURN json_build_object('success', true, 'team', NULL, 'members', '[]'::json);
  END IF;

  SELECT json_build_object(
    'id', t.id,
    'name', t.name,
    'invite_code', NULL,
    'created_at', t.created_at,
    'is_active', t.is_active,
    'deactivation_message', t.deactivation_message
  )
  INTO v_team
  FROM public.teams t
  WHERE t.id = v_team_id;

  SELECT COALESCE(
    json_agg(
      json_build_object(
        'user_id', u.id,
        'username', u.username,
        'role', CASE WHEN u.id = t.captain_user_id THEN 'captain' ELSE 'member' END,
        'joined_at', tm.joined_at
      )
      ORDER BY (u.id = t.captain_user_id) DESC, tm.joined_at ASC
    ),
    '[]'::json
  )
  INTO v_members
  FROM public.team_members tm
  JOIN public.users u ON u.id = tm.user_id
  JOIN public.teams t ON t.id = tm.team_id
  WHERE tm.team_id = v_team_id;

  RETURN json_build_object('success', true, 'team', v_team, 'members', v_members);
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION get_team_by_user_id(UUID) TO authenticated;

-- 6. Update get_team_scoreboard
CREATE OR REPLACE FUNCTION get_team_scoreboard(
  limit_rows integer DEFAULT 100,
  offset_rows integer DEFAULT 0,
  p_event_id uuid DEFAULT NULL,
  p_event_mode text DEFAULT 'any'
)
RETURNS TABLE (
  team_id UUID,
  team_name TEXT,
  unique_score BIGINT,
  total_score BIGINT,
  unique_challenges BIGINT,
  total_solves BIGINT,
  member_count BIGINT,
  rank BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH members_count AS (
    SELECT t.id AS team_id, t.name AS team_name, COUNT(tm.user_id) AS member_count
    FROM public.teams t
    LEFT JOIN public.team_members tm ON tm.team_id = t.id
    WHERE t.is_active = true
    GROUP BY t.id, t.name
  ),
  solves_filtered AS (
    SELECT tm.team_id AS team_id, s.challenge_id, s.created_at, c.points, c.event_id
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    JOIN public.solves s ON s.user_id = tm.user_id
    JOIN public.challenges c ON c.id = s.challenge_id
    WHERE t.is_active = true
    AND (
      p_event_mode = 'any'
      OR (p_event_mode = 'main' AND c.event_id IS NULL)
      OR (p_event_id IS NOT NULL AND c.event_id = p_event_id)
    )
  ),
  agg AS (
    SELECT
      solves_filtered.team_id AS team_id,
      SUM(solves_filtered.points)::BIGINT AS total_score,
      COUNT(*)::BIGINT AS total_solves,
      COUNT(DISTINCT solves_filtered.challenge_id)::BIGINT AS unique_challenges
    FROM solves_filtered
    GROUP BY solves_filtered.team_id
  ),
  unique_score_calc AS (
    SELECT t.team_id AS team_id, SUM(t.points)::BIGINT AS unique_score
    FROM (
      SELECT solves_filtered.team_id AS team_id, solves_filtered.challenge_id, MAX(solves_filtered.points) AS points
      FROM solves_filtered
      GROUP BY solves_filtered.team_id, solves_filtered.challenge_id
    ) t
    GROUP BY t.team_id
  )
  SELECT
    mc.team_id,
    mc.team_name,
    COALESCE(us.unique_score, 0) AS unique_score,
    COALESCE(a.total_score, 0) AS total_score,
    COALESCE(a.unique_challenges, 0) AS unique_challenges,
    COALESCE(a.total_solves, 0) AS total_solves,
    COALESCE(mc.member_count, 0) AS member_count,
    RANK() OVER (ORDER BY COALESCE(us.unique_score, 0) DESC) AS rank
  FROM members_count mc
  LEFT JOIN agg a ON a.team_id = mc.team_id
  LEFT JOIN unique_score_calc us ON us.team_id = mc.team_id
  ORDER BY COALESCE(us.unique_score, 0) DESC
  LIMIT limit_rows OFFSET offset_rows;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION get_team_scoreboard(integer, integer, uuid, text) TO authenticated;

-- 7. Update get_team_solves_by_names
CREATE OR REPLACE FUNCTION get_team_solves_by_names(
  p_names TEXT[], 
  p_event_id uuid DEFAULT NULL, 
  p_event_mode text DEFAULT 'any'
)
RETURNS TABLE (
  team_name TEXT,
  created_at TIMESTAMPTZ,
  points INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.name AS team_name,
    s.created_at,
    c.points
  FROM public.teams t
  JOIN public.team_members tm ON tm.team_id = t.id
  JOIN public.solves s ON s.user_id = tm.user_id
  JOIN public.challenges c ON c.id = s.challenge_id
  WHERE t.is_active = true
  AND lower(t.name) = ANY (
    SELECT lower(x) FROM unnest(p_names) AS x
  )
  AND (
    p_event_mode = 'any'
    OR (p_event_mode = 'main' AND c.event_id IS NULL)
    OR (p_event_id IS NOT NULL AND c.event_id = p_event_id)
  )
  ORDER BY t.name ASC, s.created_at ASC;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION get_team_solves_by_names(TEXT[], uuid, text) TO authenticated;

-- 8. Update get_team_unique_solves_by_names
CREATE OR REPLACE FUNCTION get_team_unique_solves_by_names(
  p_names TEXT[],
  p_event_id uuid DEFAULT NULL,
  p_event_mode text DEFAULT 'any',
  p_show_name_chall boolean DEFAULT false
)
RETURNS TABLE (
  team_name TEXT,
  created_at TIMESTAMPTZ,
  points INTEGER,
  challenge_id UUID,
  challenge_title TEXT,
  challenge_category TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH team_solves AS (
    SELECT
      t.name AS team_name,
      s.challenge_id,
      MIN(s.created_at) AS created_at,
      MAX(c.points) AS points,
      MAX(c.title) AS challenge_title,
      MAX(c.category) AS challenge_category
    FROM public.teams t
    JOIN public.team_members tm ON tm.team_id = t.id
    JOIN public.solves s ON s.user_id = tm.user_id
    JOIN public.challenges c ON c.id = s.challenge_id
    WHERE t.is_active = true
    AND lower(t.name) = ANY (
      SELECT lower(x) FROM unnest(p_names) AS x
    )
    AND (
      p_event_mode = 'any'
      OR (p_event_mode = 'main' AND c.event_id IS NULL)
      OR (p_event_id IS NOT NULL AND c.event_id = p_event_id)
    )
    GROUP BY t.name, s.challenge_id
  )
  SELECT
    ts.team_name,
    ts.created_at,
    ts.points,
    CASE WHEN p_show_name_chall THEN ts.challenge_id ELSE NULL::uuid END AS challenge_id,
    CASE WHEN p_show_name_chall THEN ts.challenge_title ELSE NULL::text END AS challenge_title,
    CASE WHEN p_show_name_chall THEN ts.challenge_category ELSE NULL::text END AS challenge_category
  FROM team_solves ts
  ORDER BY ts.team_name ASC, ts.created_at ASC;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION get_team_unique_solves_by_names(TEXT[], uuid, text, boolean) TO authenticated;

-- 9. Update get_team_solves
CREATE OR REPLACE FUNCTION get_team_solves(
  p_event_id uuid DEFAULT NULL, 
  p_event_mode text DEFAULT 'any'
)
RETURNS TABLE (
  team_name TEXT,
  created_at TIMESTAMPTZ,
  points INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.name AS team_name,
    s.created_at,
    c.points
  FROM public.teams t
  JOIN public.team_members tm ON tm.team_id = t.id
  JOIN public.solves s ON s.user_id = tm.user_id
  JOIN public.challenges c ON c.id = s.challenge_id
  WHERE t.is_active = true
  AND (
    p_event_mode = 'any'
    OR (p_event_mode = 'main' AND c.event_id IS NULL)
    OR (p_event_id IS NOT NULL AND c.event_id = p_event_id)
  )
  ORDER BY t.name ASC, s.created_at ASC;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION get_team_solves(uuid, text) TO authenticated;

-- 10. Update get_team_unique_solves
CREATE OR REPLACE FUNCTION get_team_unique_solves(
  p_event_id uuid DEFAULT NULL, 
  p_event_mode text DEFAULT 'any'
)
RETURNS TABLE (
  team_name TEXT,
  created_at TIMESTAMPTZ,
  points INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH team_solves AS (
    SELECT
      t.name AS team_name,
      s.challenge_id,
      MIN(s.created_at) AS created_at,
      MAX(c.points) AS points
    FROM public.teams t
    JOIN public.team_members tm ON tm.team_id = t.id
    JOIN public.solves s ON s.user_id = tm.user_id
    JOIN public.challenges c ON c.id = s.challenge_id
    WHERE t.is_active = true
    AND (
      p_event_mode = 'any'
      OR (p_event_mode = 'main' AND c.event_id IS NULL)
      OR (p_event_id IS NOT NULL AND c.event_id = p_event_id)
    )
    GROUP BY t.name, s.challenge_id
  )
  SELECT
    ts.team_name,
    ts.created_at,
    ts.points
  FROM team_solves ts
  ORDER BY ts.team_name ASC, ts.created_at ASC;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION get_team_unique_solves(uuid, text) TO authenticated;

-- 11. Update get_my_team
CREATE OR REPLACE FUNCTION get_my_team(
  p_event_id uuid DEFAULT NULL,
  p_event_mode text DEFAULT 'any'
)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid()::uuid;
  v_team_id UUID;
  v_team JSON;
  v_members JSON;
  v_solved_event_ids UUID[];
  v_has_main_solved BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT team_id INTO v_team_id
  FROM public.team_members
  WHERE user_id = v_user_id;

  IF v_team_id IS NULL THEN
    RETURN json_build_object('success', true, 'team', NULL, 'members', '[]'::json);
  END IF;

  SELECT json_build_object(
    'id', t.id,
    'name', t.name,
    'invite_code', t.invite_code,
    'secret_key', t.secret_key,
    'access_token', t.access_token,
    'created_at', t.created_at,
    'is_active', t.is_active,
    'deactivation_message', t.deactivation_message
  )
  INTO v_team
  FROM public.teams t
  WHERE t.id = v_team_id;

  WITH team_users AS (
    SELECT tm.user_id, tm.joined_at
    FROM public.team_members tm
    WHERE tm.team_id = v_team_id
  ), team_first AS (
    SELECT DISTINCT ON (s.challenge_id)
      s.challenge_id,
      s.user_id,
      s.created_at
    FROM public.solves s
    JOIN team_users tu ON tu.user_id = s.user_id
    JOIN public.challenges c ON c.id = s.challenge_id
    WHERE (
      p_event_mode = 'any'
      OR (p_event_mode = 'main' AND c.event_id IS NULL)
      OR (p_event_id IS NOT NULL AND c.event_id = p_event_id)
    )
    ORDER BY s.challenge_id, s.created_at ASC, s.id ASC
  ), user_stats AS (
    SELECT
      tu.user_id,
      COALESCE(SUM(c.points), 0) AS solo_score
    FROM team_users tu
    LEFT JOIN public.solves s ON s.user_id = tu.user_id
    LEFT JOIN public.challenges c ON c.id = s.challenge_id
      AND (
        p_event_mode = 'any'
        OR (p_event_mode = 'main' AND c.event_id IS NULL)
        OR (p_event_id IS NOT NULL AND c.event_id = p_event_id)
      )
    GROUP BY tu.user_id
  ), first_stats AS (
    SELECT
      tf.user_id,
      COALESCE(COUNT(*), 0) AS first_solves,
      COALESCE(SUM(c.points), 0) AS first_solve_score
    FROM team_first tf
    JOIN public.challenges c ON c.id = tf.challenge_id
    GROUP BY tf.user_id
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'user_id', u.id,
        'username', u.username,
        'role', CASE WHEN u.id = t.captain_user_id THEN 'captain' ELSE 'member' END,
        'joined_at', tm.joined_at,
        'solo_score', COALESCE(us.solo_score, 0),
        'first_solve_count', COALESCE(fs.first_solves, 0),
        'first_solve_score', COALESCE(fs.first_solve_score, 0)
      )
      ORDER BY (u.id = t.captain_user_id) DESC, tm.joined_at ASC
    ),
    '[]'::json
  )
  INTO v_members
  FROM public.team_members tm
  JOIN public.users u ON u.id = tm.user_id
  JOIN public.teams t ON t.id = tm.team_id
  LEFT JOIN user_stats us ON us.user_id = tm.user_id
  LEFT JOIN first_stats fs ON fs.user_id = tm.user_id
  WHERE tm.team_id = v_team_id;

  SELECT COALESCE(
    array_agg(DISTINCT c.event_id) FILTER (WHERE c.event_id IS NOT NULL),
    '{}'::uuid[]
  ),
  COALESCE(bool_or(c.event_id IS NULL), FALSE)
  INTO v_solved_event_ids, v_has_main_solved
  FROM public.solves s
  JOIN public.challenges c ON c.id = s.challenge_id
  JOIN public.team_members tm ON tm.user_id = s.user_id
  WHERE tm.team_id = v_team_id;

  RETURN json_build_object(
    'success', true,
    'team', v_team,
    'members', v_members,
    'solved_event_ids', v_solved_event_ids,
    'has_main_solved', v_has_main_solved
  );
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION get_my_team(uuid, text) TO authenticated;

-- 12. Update get_my_team_summary
CREATE OR REPLACE FUNCTION get_my_team_summary(
  p_event_id uuid DEFAULT NULL,
  p_event_mode text DEFAULT 'any'
)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid()::uuid;
  v_team_id UUID;
  v_team JSON;
  v_unique_score BIGINT := 0;
  v_total_score BIGINT := 0;
  v_unique_challenges INT := 0;
  v_total_solves BIGINT := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT team_id INTO v_team_id
  FROM public.team_members
  WHERE user_id = v_user_id;

  IF v_team_id IS NULL THEN
    RETURN json_build_object('success', true, 'team', NULL, 'stats', json_build_object(
      'unique_score', 0,
      'total_score', 0,
      'unique_challenges', 0,
      'total_solves', 0
    ));
  END IF;

  SELECT json_build_object(
    'id', t.id,
    'name', t.name,
    'invite_code', t.invite_code,
    'secret_key', t.secret_key,
    'access_token', t.access_token,
    'created_at', t.created_at,
    'is_active', t.is_active,
    'deactivation_message', t.deactivation_message
  )
  INTO v_team
  FROM public.teams t
  WHERE t.id = v_team_id;

  WITH team_users AS (
    SELECT user_id FROM public.team_members WHERE team_id = v_team_id
  ), solves_filtered AS (
    SELECT s.challenge_id, c.points
    FROM public.solves s
    JOIN team_users tu ON tu.user_id = s.user_id
    JOIN public.challenges c ON c.id = s.challenge_id
    WHERE (
      p_event_mode = 'any'
      OR (p_event_mode = 'main' AND c.event_id IS NULL)
      OR (p_event_id IS NOT NULL AND c.event_id = p_event_id)
    )
  ), unique_calc AS (
    SELECT
      COALESCE(SUM(t.points), 0)::BIGINT AS unique_score,
      COALESCE(COUNT(*), 0)::INT AS unique_challenges
    FROM (
      SELECT sf.challenge_id, MAX(sf.points) AS points
      FROM solves_filtered sf
      GROUP BY sf.challenge_id
    ) t
  ), totals AS (
    SELECT
      COALESCE(SUM(sf.points), 0)::BIGINT AS total_score,
      COALESCE(COUNT(*), 0)::BIGINT AS total_solves
    FROM solves_filtered sf
  )
  SELECT
    uc.unique_score,
    t.total_score,
    uc.unique_challenges,
    t.total_solves
  INTO v_unique_score, v_total_score, v_unique_challenges, v_total_solves
  FROM unique_calc uc
  CROSS JOIN totals t;

  RETURN json_build_object('success', true, 'team', v_team, 'stats', json_build_object(
    'unique_score', v_unique_score,
    'total_score', v_total_score,
    'unique_challenges', v_unique_challenges,
    'total_solves', v_total_solves
  ));
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION get_my_team_summary(uuid, text) TO authenticated;

-- 13. Update get_leaderboard
CREATE OR REPLACE FUNCTION get_leaderboard(
  limit_rows integer DEFAULT 100,
  offset_rows integer DEFAULT 0,
  p_event_id UUID DEFAULT NULL,
  p_event_mode TEXT DEFAULT 'any'
)
RETURNS TABLE (
  id UUID,
  username TEXT,
  score BIGINT,
  last_solve TIMESTAMPTZ,
  rank BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.username,
    COALESCE(
      SUM(
        CASE WHEN (
          p_event_mode = 'any'
          OR (p_event_mode = 'is_null' AND c.event_id IS NULL)
          OR (p_event_mode = 'equals' AND c.event_id = p_event_id)
        ) THEN c.points ELSE 0 END
      ), 0
    ) AS score,
    MAX(
      CASE WHEN (
        p_event_mode = 'any'
        OR (p_event_mode = 'is_null' AND c.event_id IS NULL)
        OR (p_event_mode = 'equals' AND c.event_id = p_event_id)
      ) THEN s.created_at ELSE NULL END
    ) AS last_solve,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(
        SUM(CASE WHEN (
          p_event_mode = 'any'
          OR (p_event_mode = 'is_null' AND c.event_id IS NULL)
          OR (p_event_mode = 'equals' AND c.event_id = p_event_id)
        ) THEN c.points ELSE 0 END), 0
      ) DESC,
      MAX(CASE WHEN (
        p_event_mode = 'any'
        OR (p_event_mode = 'is_null' AND c.event_id IS NULL)
        OR (p_event_mode = 'equals' AND c.event_id = p_event_id)
      ) THEN s.created_at ELSE NULL END) ASC
    ) AS rank
  FROM public.users u
  LEFT JOIN public.solves s ON u.id = s.user_id
  LEFT JOIN public.challenges c ON s.challenge_id = c.id
  WHERE NOT EXISTS (
    SELECT 1 
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.user_id = u.id AND t.is_active = false
  )
  GROUP BY u.id, u.username
  HAVING COALESCE(
    SUM(
      CASE WHEN (
        p_event_mode = 'any'
        OR (p_event_mode = 'is_null' AND c.event_id IS NULL)
        OR (p_event_mode = 'equals' AND c.event_id = p_event_id)
      ) THEN c.points ELSE 0 END
    ), 0
  ) > 0
  ORDER BY score DESC, last_solve ASC
  LIMIT limit_rows OFFSET offset_rows;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION get_leaderboard(integer, integer, uuid, text) TO authenticated;

-- 14. Update get_top_progress
CREATE OR REPLACE FUNCTION get_top_progress(
  p_user_ids UUID[],
  p_limit INT DEFAULT 1000,
  p_offset INT DEFAULT 0,
  p_event_id UUID DEFAULT NULL,
  p_event_mode TEXT DEFAULT 'any'
)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  created_at TIMESTAMPTZ,
  points INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.user_id,
    u.username,
    s.created_at,
    c.points
  FROM public.solves s
  JOIN public.challenges c ON c.id = s.challenge_id
  JOIN public.users u ON u.id = s.user_id
  WHERE s.user_id = ANY(p_user_ids)
    AND NOT EXISTS (
      SELECT 1 
      FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id
      WHERE tm.user_id = u.id AND t.is_active = false
    )
    AND (
      p_event_mode = 'any'
      OR (p_event_mode = 'is_null' AND c.event_id IS NULL)
      OR (p_event_mode = 'equals' AND c.event_id = p_event_id)
    )
  ORDER BY s.created_at ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION get_top_progress(UUID[], INT, INT, UUID, TEXT) TO authenticated;

-- 15. Update detail_user
CREATE OR REPLACE FUNCTION detail_user(
  p_id UUID, 
  p_event_id UUID DEFAULT NULL, 
  p_event_mode TEXT DEFAULT 'any'
)
RETURNS JSON
AS $$
DECLARE
  v_user RECORD;
  v_rank BIGINT;
  v_score INT;
  v_solves JSON;
  v_picture TEXT;
  v_last_login TIMESTAMPTZ;
BEGIN
  SELECT id, username, bio, sosmed, profile_picture_url, created_at
  INTO v_user
  FROM public.users
  WHERE id = p_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', 'User not found');
  END IF;

  SELECT
    COALESCE(
      au.raw_user_meta_data->>'picture',
      au.raw_user_meta_data->>'avatar_url',
      v_user.profile_picture_url
    ),
    NULLIF(
      GREATEST(
        COALESCE(au.last_sign_in_at, 'epoch'::timestamptz),
        COALESCE(au.updated_at, 'epoch'::timestamptz)
      ),
      'epoch'::timestamptz
    )
  INTO v_picture, v_last_login
  FROM auth.users au
  WHERE au.id = v_user.id;

  SELECT r.rank
  INTO v_rank
  FROM (
    SELECT
      u.id,
      RANK() OVER (
        ORDER BY COALESCE(SUM(CASE WHEN (
          p_event_mode = 'any'
          OR (p_event_mode = 'is_null' AND c.event_id IS NULL)
          OR (p_event_mode = 'equals' AND c.event_id = p_event_id)
        ) THEN c.points ELSE 0 END), 0) DESC,
                 MAX(CASE WHEN (
          p_event_mode = 'any'
          OR (p_event_mode = 'is_null' AND c.event_id IS NULL)
          OR (p_event_mode = 'equals' AND c.event_id = p_event_id)
        ) THEN s.created_at ELSE NULL END) ASC
      ) AS rank
    FROM public.users u
    LEFT JOIN public.solves s ON u.id = s.user_id
    LEFT JOIN public.challenges c ON s.challenge_id = c.id
    WHERE NOT EXISTS (
      SELECT 1 
      FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id
      WHERE tm.user_id = u.id AND t.is_active = false
    )
    GROUP BY u.id
  ) r
  WHERE r.id = p_id;

  SELECT COALESCE(SUM(CASE WHEN (
    p_event_mode = 'any'
    OR (p_event_mode = 'is_null' AND c.event_id IS NULL)
    OR (p_event_mode = 'equals' AND c.event_id = p_event_id)
  ) THEN c.points ELSE 0 END), 0)
  INTO v_score
  FROM public.solves s
  JOIN public.challenges c ON s.challenge_id = c.id
  WHERE s.user_id = p_id
    AND NOT EXISTS (
      SELECT 1 
      FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id
      WHERE tm.user_id = p_id AND t.is_active = false
    );

  SELECT COALESCE(
    json_agg(
      json_build_object(
        'challenge_id', c.id,
        'title', c.title,
        'category', c.category,
        'points', c.points,
        'difficulty', c.difficulty,
        'solved_at', s.created_at
      )
      ORDER BY s.created_at DESC
    ),
    '[]'::json
  )
  INTO v_solves
  FROM public.solves s
  JOIN public.challenges c ON s.challenge_id = c.id
  WHERE s.user_id = p_id
    AND NOT EXISTS (
      SELECT 1 
      FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id
      WHERE tm.user_id = p_id AND t.is_active = false
    )
    AND (
      p_event_mode = 'any'
      OR (p_event_mode = 'is_null' AND c.event_id IS NULL)
      OR (p_event_mode = 'equals' AND c.event_id = p_event_id)
    );

  RETURN json_build_object(
    'success', true,
    'user', json_build_object(
      'id', v_user.id,
      'username', v_user.username,
      'rank', COALESCE(v_rank, 0),
      'score', COALESCE(v_score, 0),
      'picture', v_picture,
      'bio', COALESCE(v_user.bio, ''),
      'sosmed', COALESCE(v_user.sosmed, '{}'::jsonb),
      'profile_picture_url', v_user.profile_picture_url,
      'created_at', v_user.created_at,
      'last_login_at', v_last_login
    ),
    'solved_challenges', v_solves
  );
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION detail_user(UUID, UUID, TEXT) TO authenticated;

-- 16. Update get_user_profile (dropping it first to allow return type change)
DROP FUNCTION IF EXISTS get_user_profile(UUID) CASCADE;

CREATE OR REPLACE FUNCTION get_user_profile(p_id UUID)
RETURNS TABLE (
  id UUID,
  username TEXT,
  picture TEXT,
  profile_picture_url TEXT,
  solved_event_ids UUID[],
  has_main_solved BOOLEAN,
  team_id UUID,
  team_name TEXT,
  team_is_active BOOLEAN,
  team_deactivation_message TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.username,
    COALESCE(
      au.raw_user_meta_data->>'picture',
      au.raw_user_meta_data->>'avatar_url',
      u.profile_picture_url
    ) AS picture,
    u.profile_picture_url,
    COALESCE(
      (
        SELECT array_agg(DISTINCT c.event_id) FILTER (WHERE c.event_id IS NOT NULL)
        FROM public.solves s
        JOIN public.challenges c ON c.id = s.challenge_id
        WHERE s.user_id = u.id
      ),
      '{}'::uuid[]
    ) AS solved_event_ids,
    EXISTS (
      SELECT 1
      FROM public.solves s
      JOIN public.challenges c ON c.id = s.challenge_id
      WHERE s.user_id = u.id
        AND c.event_id IS NULL
    ) AS has_main_solved,
    t.id AS team_id,
    t.name AS team_name,
    t.is_active AS team_is_active,
    t.deactivation_message AS team_deactivation_message
  FROM public.users u
  LEFT JOIN auth.users au ON au.id = u.id
  LEFT JOIN public.team_members tm ON tm.user_id = u.id
  LEFT JOIN public.teams t ON t.id = tm.team_id
  WHERE u.id = p_id;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_profile(UUID) TO authenticated;
