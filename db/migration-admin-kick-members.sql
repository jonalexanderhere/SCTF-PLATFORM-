-- Migration: Support admin kicking members and return full member objects in admin list
-- Path: db/migration-admin-kick-members.sql

-- 1. Update admin_get_all_teams to return member objects (id, username, is_captain)
CREATE OR REPLACE FUNCTION public.admin_get_all_teams()
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

GRANT EXECUTE ON FUNCTION public.admin_get_all_teams() TO authenticated;

-- 2. Update kick_team_member to handle transferring captaincy if the kicked user is the captain
CREATE OR REPLACE FUNCTION public.kick_team_member(p_team_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_requester UUID := auth.uid()::uuid;
  v_is_member BOOLEAN;
  v_is_captain BOOLEAN;
  v_captain_id UUID;
  v_next_captain UUID;
BEGIN
  IF v_requester IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Standard members/captains cannot kick themselves (they should leave instead)
  -- But admins can do it if needed (or we can block all self-kicks)
  IF v_requester = p_user_id THEN
    RAISE EXCEPTION 'Cannot kick yourself';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.team_members
    WHERE team_id = p_team_id AND user_id = p_user_id
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'User not in team';
  END IF;

  v_is_captain := is_team_captain(p_team_id);

  IF NOT is_admin() AND NOT v_is_captain THEN
    RAISE EXCEPTION 'Only captain or admin can kick members';
  END IF;

  -- If the kicked member is the captain, find the next captain
  SELECT captain_user_id INTO v_captain_id
  FROM public.teams WHERE id = p_team_id;

  IF v_captain_id = p_user_id THEN
    SELECT user_id INTO v_next_captain
    FROM public.team_members
    WHERE team_id = p_team_id AND user_id != p_user_id
    ORDER BY joined_at ASC
    LIMIT 1;

    UPDATE public.teams SET captain_user_id = v_next_captain WHERE id = p_team_id;
  END IF;

  DELETE FROM public.team_members
  WHERE team_id = p_team_id AND user_id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION public.kick_team_member(UUID, UUID) TO authenticated;
