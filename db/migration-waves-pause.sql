-- Migration: Add Event Waves and Event Pause features

-- 1. Alter events table to add wave and pause columns
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT FALSE;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS active_waves INTEGER[] DEFAULT ARRAY[1]::INTEGER[];
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS waves_count INTEGER DEFAULT 1;

-- 2. Alter challenges table to add wave column
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS wave INTEGER DEFAULT 1;

-- 3. Drop and Recreate RLS Policy for Challenges Select Visible
DROP POLICY IF EXISTS "Challenges user select visible" ON public.challenges;
CREATE POLICY "Challenges user select visible"
ON public.challenges
FOR SELECT
USING (
  is_active = true
  AND (
    event_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = challenges.event_id
        AND (
          COALESCE(e.join_mode, 'open') = 'open'
          OR EXISTS (
            SELECT 1
            FROM public.event_participants ep
            WHERE ep.event_id = e.id
              AND ep.user_id = auth.uid()::uuid
          )
        )
        AND (
          challenges.wave = ANY(e.active_waves)
        )
        AND (
          (
            (e.start_time IS NULL OR now() >= e.start_time)
            AND (e.end_time IS NULL OR now() <= e.end_time)
          )
          OR (
            e.always_show_challenges = true
            AND e.end_time IS NOT NULL
            AND now() > e.end_time
          )
        )
    )
  )
);

-- 4. Drop old add_challenge and create updated add_challenge function
DROP FUNCTION IF EXISTS add_challenge(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB, JSONB, BOOLEAN, BOOLEAN, INTEGER, INTEGER, INTEGER, UUID, BOOLEAN, TEXT[]);

CREATE OR REPLACE FUNCTION add_challenge(
  p_title TEXT,
  p_description TEXT,
  p_category TEXT,
  p_points INTEGER,
  p_flag TEXT,
  p_difficulty TEXT,
  p_hint JSONB DEFAULT NULL,
  p_attachments JSONB DEFAULT '[]',
  p_is_dynamic BOOLEAN DEFAULT false,
  p_is_maintenance BOOLEAN DEFAULT false,
  p_min_points INTEGER DEFAULT 0,
  p_decay_per_solve INTEGER DEFAULT 0,
  p_max_points INTEGER DEFAULT NULL,
  p_event_id UUID DEFAULT NULL,
  p_flag_placeholder BOOLEAN DEFAULT false,
  p_services TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_wave INTEGER DEFAULT 1
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID := auth.uid()::uuid;
  v_challenge_id UUID;
BEGIN
  IF NOT can_manage_event(p_event_id) THEN
    RAISE EXCEPTION 'Only admin can add challenge';
  END IF;

  INSERT INTO public.challenges(
    title, description, category, points, max_points, hint, attachments, difficulty, 
    is_active, is_maintenance, is_dynamic, min_points, decay_per_solve, event_id, 
    flag_placeholder, services, wave
  )
  VALUES (
    p_title, p_description, p_category, p_points, p_max_points, p_hint, p_attachments, p_difficulty, 
    true, p_is_maintenance, p_is_dynamic, p_min_points, p_decay_per_solve, p_event_id, 
    p_flag_placeholder, p_services, COALESCE(p_wave, 1)
  )
  RETURNING id INTO v_challenge_id;

  INSERT INTO public.challenge_flags(challenge_id, flag)
  VALUES (v_challenge_id, p_flag);

  RETURN v_challenge_id;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION add_challenge(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB, JSONB, BOOLEAN, BOOLEAN, INTEGER, INTEGER, INTEGER, UUID, BOOLEAN, TEXT[], INTEGER) TO authenticated;

-- 5. Drop old update_challenge and create updated update_challenge function
DROP FUNCTION IF EXISTS update_challenge(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB, JSONB, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, INTEGER, INTEGER, INTEGER, UUID, BOOLEAN, TEXT[]);

CREATE OR REPLACE FUNCTION update_challenge(
  p_challenge_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_category TEXT,
  p_points INTEGER,
  p_difficulty TEXT,
  p_hint JSONB DEFAULT NULL,
  p_attachments JSONB DEFAULT '[]',
  p_is_active BOOLEAN DEFAULT NULL,
  p_is_maintenance BOOLEAN DEFAULT NULL,
  p_flag TEXT DEFAULT NULL,
  p_is_dynamic BOOLEAN DEFAULT false,
  p_min_points INTEGER DEFAULT 0,
  p_decay_per_solve INTEGER DEFAULT 0,
  p_max_points INTEGER DEFAULT NULL,
  p_event_id UUID DEFAULT NULL,
  p_flag_placeholder BOOLEAN DEFAULT NULL,
  p_services TEXT[] DEFAULT NULL,
  p_wave INTEGER DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID := auth.uid()::uuid;
  v_solver_count INT;
  v_existing_event_id UUID;
BEGIN
  SELECT c.event_id INTO v_existing_event_id
  FROM public.challenges c
  WHERE c.id = p_challenge_id;

  IF NOT can_manage_event(v_existing_event_id) OR NOT can_manage_event(p_event_id) THEN
    RAISE EXCEPTION 'Only admin can update challenge';
  END IF;

  UPDATE public.challenges
  SET title = p_title,
      description = p_description,
      category = p_category,
      points = p_points,
      max_points = p_max_points,
      difficulty = p_difficulty,
      hint = p_hint,
      attachments = p_attachments,
      is_active = COALESCE(p_is_active, is_active),
      is_maintenance = COALESCE(p_is_maintenance, is_maintenance),
      is_dynamic = p_is_dynamic,
      min_points = p_min_points,
      decay_per_solve = p_decay_per_solve,
      event_id = p_event_id,
      flag_placeholder = COALESCE(p_flag_placeholder, flag_placeholder),
      services = COALESCE(p_services, services),
      wave = COALESCE(p_wave, wave),
      updated_at = now()
  WHERE id = p_challenge_id;

  IF p_is_dynamic THEN
    SELECT COUNT(*) INTO v_solver_count FROM public.solves WHERE challenge_id = p_challenge_id;
    IF v_solver_count > 0 THEN
      v_solver_count := v_solver_count - 1;
    END IF;
    UPDATE public.challenges
    SET points = GREATEST(
      COALESCE(p_min_points, 0),
      COALESCE(p_max_points, 0) - COALESCE(p_decay_per_solve, 0) * v_solver_count
    )
    WHERE id = p_challenge_id;
  END IF;

  IF p_flag IS NOT NULL THEN
    UPDATE public.challenge_flags
    SET flag = p_flag
    WHERE challenge_id = p_challenge_id;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_challenge(
  uuid, text, text, text, integer, text, jsonb, jsonb, boolean, boolean, text, boolean, integer, integer, integer, uuid, boolean, text[], integer
) TO authenticated;

-- 6. Drop and Recreate submit_flag function
CREATE OR REPLACE FUNCTION submit_flag(
  p_challenge_id uuid,
  p_flag text
)
RETURNS json AS $$
DECLARE
  v_user_id uuid := auth.uid()::uuid;
  v_flag_hash TEXT;
  v_points INTEGER;
  v_max_points INTEGER;
  v_is_dynamic BOOLEAN;
  v_is_maintenance BOOLEAN;
  v_is_active BOOLEAN;
  v_min_points INTEGER;
  v_decay_per_solve INTEGER;
  v_event_id UUID;
  v_event_start TIMESTAMPTZ;
  v_event_end TIMESTAMPTZ;
  v_event_exists BOOLEAN;
  v_event_join_mode TEXT;
  v_event_is_paused BOOLEAN;
  v_event_active_waves INTEGER[];
  v_challenge_wave INTEGER;
  v_is_event_member BOOLEAN := FALSE;
  v_solver_count INTEGER;
  v_awarded_points INTEGER;
  v_existing INT;
  v_is_correct BOOLEAN;
  v_is_admin_override BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT cf.flag_hash, c.points, c.max_points, c.is_dynamic, c.is_active, c.is_maintenance, c.min_points, c.decay_per_solve,
        c.event_id, e.start_time, e.end_time, (e.id IS NOT NULL), e.join_mode,
        e.is_paused, e.active_waves, c.wave
    INTO v_flag_hash, v_points, v_max_points, v_is_dynamic, v_is_active, v_is_maintenance, v_min_points, v_decay_per_solve,
      v_event_id, v_event_start, v_event_end, v_event_exists, v_event_join_mode,
      v_event_is_paused, v_event_active_waves, v_challenge_wave
  FROM public.challenge_flags cf
  JOIN public.challenges c ON c.id = cf.challenge_id
  LEFT JOIN public.events e ON e.id = c.event_id
  WHERE cf.challenge_id = p_challenge_id;

  IF v_flag_hash IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Challenge not found');
  END IF;

  v_is_admin_override := is_admin() OR can_manage_challenge(p_challenge_id);

  IF NOT v_is_admin_override THEN
    IF COALESCE(v_is_maintenance, false) THEN
      RETURN json_build_object('success', false, 'message', 'Challenge is under maintenance');
    END IF;

    IF NOT COALESCE(v_is_active, TRUE) THEN
      RETURN json_build_object('success', false, 'message', 'Challenge is not active');
    END IF;

    -- [WAVES BLOCK] Check if challenge wave is active in the event
    IF v_event_id IS NOT NULL AND NOT (COALESCE(v_challenge_wave, 1) = ANY(COALESCE(v_event_active_waves, ARRAY[1]::INTEGER[]))) THEN
      RETURN json_build_object('success', false, 'message', 'Challenge wave is not open');
    END IF;

    -- [PAUSE BLOCK] Check if event is paused
    IF v_event_id IS NOT NULL AND COALESCE(v_event_is_paused, false) THEN
      RETURN json_build_object('success', false, 'message', 'Event/Challenge is paused');
    END IF;
  END IF;

  IF v_event_id IS NOT NULL AND NOT COALESCE(v_event_exists, false) THEN
    RETURN json_build_object('success', false, 'message', 'Event not found');
  END IF;

  IF NOT v_is_admin_override THEN
    IF v_event_id IS NOT NULL THEN
      IF COALESCE(v_event_join_mode, 'open') <> 'open' THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.event_participants ep
          WHERE ep.event_id = v_event_id
            AND ep.user_id = v_user_id
        ) INTO v_is_event_member;

        IF NOT v_is_event_member THEN
          RETURN json_build_object('success', false, 'message', 'Join this event first before submitting flags');
        END IF;
      END IF;

      IF v_event_start IS NOT NULL AND now() < v_event_start THEN
        RETURN json_build_object('success', false, 'message', 'Event has not started yet');
      END IF;

      IF v_event_end IS NOT NULL AND now() > v_event_end THEN
        RETURN json_build_object('success', false, 'message', 'Event has ended');
      END IF;
    END IF;
  END IF;

  v_is_correct := encode(digest(p_flag, 'sha256'), 'hex') = v_flag_hash;

  -- Log the submission attempt
  IF NOT v_is_admin_override THEN
    INSERT INTO public.flag_submissions (user_id, challenge_id, submitted_flag, is_correct)
    VALUES (v_user_id, p_challenge_id, p_flag, v_is_correct);
  END IF;

  IF NOT v_is_correct THEN
    RETURN json_build_object('success', false, 'message', 'Incorrect flag');
  END IF;

  SELECT count(*) INTO v_existing
  FROM public.solves
  WHERE user_id = v_user_id AND challenge_id = p_challenge_id;

  IF v_existing > 0 THEN
    IF v_is_admin_override THEN
      RETURN json_build_object('success', true, 'message', 'Correct (admin). No points awarded.');
    ELSE
      RETURN json_build_object('success', true, 'message', 'Correct, but already solved.');
    END IF;
  END IF;

  IF v_is_admin_override THEN
    RETURN json_build_object('success', true, 'message', 'Correct (admin). No points awarded.');
  END IF;

  IF v_is_dynamic THEN
    SELECT points INTO v_awarded_points FROM public.challenges WHERE id = p_challenge_id;
  ELSE
    v_awarded_points := v_points;
  END IF;

  INSERT INTO public.solves(user_id, challenge_id) VALUES (v_user_id, p_challenge_id);

  RETURN json_build_object('success', true, 'message', format('Correct! +%s points.', v_awarded_points));
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION submit_flag(uuid, text) TO authenticated;
