import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/const';
import { Client } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // 1. Authorize admin
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.split(' ')[1];
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized: Missing token' }, { status: 401 });
    }

    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    const { data: { user }, error: userErr } = await userSupabase.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
    }

    const { data: isAdmin, error: adminErr } = await userSupabase.rpc('is_admin');
    if (adminErr || !isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // 2. Parse query parameters
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const filterType = searchParams.get('type') || 'all'; // all, view, correct, incorrect
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const dbUrl = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
    if (!dbUrl) {
      return NextResponse.json({ error: 'Database connection URL not configured' }, { status: 500 });
    }

    const connectionString = dbUrl.replace(/sslmode=[^&]+&?/, '').replace(/\?$/, '').replace(/\?&/, '?');
    const pgClient = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });

    await pgClient.connect();

    // 3. Build conditions
    const queryConditions: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (search) {
      queryConditions.push(`(username ILIKE $${paramIndex} OR challenge_title ILIKE $${paramIndex})`);
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    if (filterType === 'view') {
      queryConditions.push(`event_type = 'view'`);
    } else if (filterType === 'correct') {
      queryConditions.push(`event_type = 'submission' AND is_correct = true`);
    } else if (filterType === 'incorrect') {
      queryConditions.push(`event_type = 'submission' AND is_correct = false`);
    }

    const whereClause = queryConditions.length > 0 ? `WHERE ${queryConditions.join(' AND ')}` : '';

    const logsQuery = `
      WITH combined_logs AS (
        SELECT 
          cv.id,
          cv.created_at,
          cv.user_id,
          u.username,
          cv.challenge_id,
          c.title AS challenge_title,
          'view' AS event_type,
          NULL AS submitted_flag,
          NULL::boolean AS is_correct,
          COALESCE(t.name, '-') AS team_name
        FROM public.challenge_views cv
        JOIN public.users u ON u.id = cv.user_id
        JOIN public.challenges c ON c.id = cv.challenge_id
        LEFT JOIN public.team_members tm ON tm.user_id = u.id
        LEFT JOIN public.teams t ON t.id = tm.team_id

        UNION ALL

        SELECT 
          fs.id,
          fs.created_at,
          fs.user_id,
          u.username,
          fs.challenge_id,
          c.title AS challenge_title,
          'submission' AS event_type,
          fs.submitted_flag,
          fs.is_correct,
          COALESCE(t.name, '-') AS team_name
        FROM public.flag_submissions fs
        JOIN public.users u ON u.id = fs.user_id
        JOIN public.challenges c ON c.id = fs.challenge_id
        LEFT JOIN public.team_members tm ON tm.user_id = u.id
        LEFT JOIN public.teams t ON t.id = tm.team_id
      )
      SELECT * FROM combined_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const totalCountQuery = `
      WITH combined_logs AS (
        SELECT 
          cv.id,
          cv.created_at,
          u.username,
          c.title AS challenge_title,
          'view' AS event_type,
          NULL::boolean AS is_correct
        FROM public.challenge_views cv
        JOIN public.users u ON u.id = cv.user_id
        JOIN public.challenges c ON c.id = cv.challenge_id
        UNION ALL
        SELECT 
          fs.id,
          fs.created_at,
          u.username,
          c.title AS challenge_title,
          'submission' AS event_type,
          fs.is_correct
        FROM public.flag_submissions fs
        JOIN public.users u ON u.id = fs.user_id
        JOIN public.challenges c ON c.id = fs.challenge_id
      )
      SELECT COUNT(*)::integer AS total FROM combined_logs
      ${whereClause}
    `;

    const logsRes = await pgClient.query(logsQuery, [...queryParams, limit, offset]);
    const totalCountRes = await pgClient.query(totalCountQuery, queryParams);
    const total = totalCountRes.rows[0]?.total || 0;

    // 4. Query Suspects (Most incorrect attempts)
    const suspectsRes = await pgClient.query(`
      SELECT 
        u.username,
        COALESCE(t.name, '-') AS team_name,
        COUNT(fs.id)::integer AS incorrect_count,
        MAX(fs.created_at) AS last_attempt_at
      FROM public.flag_submissions fs
      JOIN public.users u ON u.id = fs.user_id
      LEFT JOIN public.team_members tm ON tm.user_id = u.id
      LEFT JOIN public.teams t ON t.id = tm.team_id
      WHERE fs.is_correct = false
      GROUP BY u.username, t.name
      ORDER BY incorrect_count DESC
      LIMIT 10
    `);

    // 5. Query overall telemetry stats
    const statsRes = await pgClient.query(`
      SELECT
        (SELECT COUNT(*)::integer FROM public.challenge_views) AS total_views,
        (SELECT COUNT(*)::integer FROM public.flag_submissions WHERE is_correct = true) AS total_solves,
        (SELECT COUNT(*)::integer FROM public.flag_submissions WHERE is_correct = false) AS total_incorrect
    `);

    await pgClient.end();

    return NextResponse.json({
      success: true,
      logs: logsRes.rows,
      total,
      suspects: suspectsRes.rows,
      stats: statsRes.rows[0]
    });

  } catch (err: any) {
    console.error('[AdminLogs API] Error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    // 1. Authorize admin
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.split(' ')[1];
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized: Missing token' }, { status: 401 });
    }

    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    const { data: { user }, error: userErr } = await userSupabase.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
    }

    const { data: isAdmin, error: adminErr } = await userSupabase.rpc('is_admin');
    if (adminErr || !isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const dbUrl = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
    if (!dbUrl) {
      return NextResponse.json({ error: 'Database connection URL not configured' }, { status: 500 });
    }

    const connectionString = dbUrl.replace(/sslmode=[^&]+&?/, '').replace(/\?$/, '').replace(/\?&/, '?');
    const pgClient = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });

    await pgClient.connect();

    // 2. Clear telemetry tables
    await pgClient.query('DELETE FROM public.challenge_views;');
    await pgClient.query('DELETE FROM public.flag_submissions;');

    await pgClient.end();

    return NextResponse.json({
      success: true,
      message: 'Successfully cleared all telemetry logs'
    });

  } catch (err: any) {
    console.error('[AdminLogs DELETE API] Error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

