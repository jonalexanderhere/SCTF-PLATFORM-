import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/const';
import { Client } from 'pg';

async function sendDiscordNotification(payload: any) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (botToken && channelId) {
    console.log('[FirstBlood Webhook] Sending via Discord Bot Token to channel:', channelId);
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Discord Bot API Error: ${text}`);
    }
    return true;
  } else if (webhookUrl) {
    console.log('[FirstBlood Webhook] Sending via Discord Webhook URL');
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Discord Webhook Error: ${text}`);
    }
    return true;
  } else {
    throw new Error('Neither Discord Bot (DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID) nor Webhook (DISCORD_WEBHOOK_URL) is configured.');
  }
}

// GET request for testing connection and running DB diagnostics
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get('secret');
    
    // Optional secret check if WEBHOOK_SECRET is set
    const secretToken = process.env.WEBHOOK_SECRET;
    if (secretToken && secret !== secretToken) {
      return NextResponse.json({ error: 'Unauthorized. Please provide ?secret=your_secret in URL' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const publicAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const runQuery = async (key: string | undefined, keyName: string) => {
      if (!key) return { status: 'Not Configured' };
      try {
        const client = createClient(supabaseUrl, key);
        const { data, error } = await client.from('solves').select('id').limit(1);
        if (error) {
          return {
            status: 'Error',
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code
          };
        }
        return { status: 'Success', rowsFetched: data?.length || 0 };
      } catch (err: any) {
        return { status: 'Crash', error: err.message || err };
      }
    };

    const diagnostics = {
      serviceRole: await runQuery(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY'),
      publicAnon: await runQuery(publicAnonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      publishable: await runQuery(publishableKey, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
      constAnon: await runQuery(SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY'),
    };

    return NextResponse.json({
      success: true,
      message: 'Diagnostics completed',
      envConfig: {
        urlExists: !!supabaseUrl,
        urlLength: supabaseUrl?.length,
        hasServiceRole: !!serviceRoleKey,
        serviceRoleLength: serviceRoleKey?.length,
        hasPublicAnon: !!publicAnonKey,
        publicAnonLength: publicAnonKey?.length,
        hasPublishable: !!publishableKey,
        publishableLength: publishableKey?.length,
        hasConstAnon: !!SUPABASE_ANON_KEY,
        constAnonLength: SUPABASE_ANON_KEY?.length
      },
      diagnostics
    });

  } catch (err: any) {
    console.error('[FirstBlood Webhook Test] Error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const secretToken = process.env.WEBHOOK_SECRET;
    if (secretToken) {
      const headerSecret = req.headers.get('x-webhook-secret');
      if (headerSecret !== secretToken) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const body = await req.json();
    console.log('[FirstBlood Webhook] Received payload:', body);

    // Support both Supabase Webhook payload format and direct JSON
    // Supabase Webhook format: { type: 'INSERT', table: 'solves', record: { id, user_id, challenge_id } }
    const record = body.record || body;
    const challengeId = record.challenge_id;
    const userId = record.user_id;
    const solveId = record.id;

    if (!challengeId || !userId) {
      return NextResponse.json({ error: 'Missing challenge_id or user_id' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL;
    
    // Debug keys configuration safely
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const publicAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    console.log('[FirstBlood Webhook] Supabase Init Config:', {
      urlExists: !!supabaseUrl,
      urlLength: supabaseUrl?.length,
      hasServiceRole: !!serviceRoleKey,
      serviceRoleLength: serviceRoleKey?.length,
      hasPublicAnon: !!publicAnonKey,
      publicAnonLength: publicAnonKey?.length,
      hasPublishable: !!publishableKey,
      publishableLength: publishableKey?.length,
      hasConstAnon: !!SUPABASE_ANON_KEY,
      constAnonLength: SUPABASE_ANON_KEY?.length,
    });

    // Prioritize the working anon/publishable keys since the configured serviceRoleKey is currently invalid/unauthorized
    const supabaseKey = publicAnonKey || publishableKey || SUPABASE_ANON_KEY || serviceRoleKey;
    console.log('[FirstBlood Webhook] Using key prefix:', supabaseKey ? supabaseKey.substring(0, 20) + '...' : 'NONE');

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Verify if this solve is the first blood for the challenge
    const { data: solves, error: solvesError } = await supabase
      .from('solves')
      .select('id, user_id, created_at')
      .eq('challenge_id', challengeId)
      .order('created_at', { ascending: true });

    if (solvesError) {
      console.error('[FirstBlood Webhook] Supabase solves fetch error details:', {
        message: solvesError.message,
        details: solvesError.details,
        hint: solvesError.hint,
        code: solvesError.code,
      });
      return NextResponse.json({ 
        error: `Supabase query failed: ${solvesError.message}`, 
        details: solvesError.details 
      }, { status: 500 });
    }

    if (!solves || solves.length === 0) {
      console.log('[FirstBlood Webhook] No solves found for challenge:', challengeId);
      return NextResponse.json({ error: 'No solves found for this challenge' }, { status: 404 });
    }

    const firstSolve = solves[0];
    const isFirstBlood = solveId ? firstSolve.id === solveId : firstSolve.user_id === userId;

    // 2. Fetch Details (User, Challenge, Team)
    let username = 'Unknown Player';
    let challengeTitle = 'Unknown';
    let challengeCategory = 'Unknown';
    let teamName = '-';
    let dbSuccess = false;

    const dbUrl = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
    if (dbUrl) {
      const connectionString = dbUrl.replace(/sslmode=[^&]+&?/, '').replace(/\?$/, '').replace(/\?&/, '?');
      const pgClient = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
      });
      try {
        await pgClient.connect();
        const dbRes = await pgClient.query(`
          SELECT 
            u.username,
            c.title AS challenge_title,
            c.category AS challenge_category,
            t.name AS team_name
          FROM public.users u
          CROSS JOIN public.challenges c
          LEFT JOIN public.team_members tm ON tm.user_id = u.id
          LEFT JOIN public.teams t ON t.id = tm.team_id
          WHERE u.id = $1 AND c.id = $2
        `, [userId, challengeId]);

        if (dbRes.rows.length > 0) {
          const row = dbRes.rows[0];
          username = row.username || 'Unknown Player';
          challengeTitle = row.challenge_title || 'Unknown';
          challengeCategory = row.challenge_category || 'Unknown';
          teamName = row.team_name ? row.team_name.trim() : '-';
          dbSuccess = true;
        }
      } catch (dbErr: any) {
        console.error('[FirstBlood Webhook] Direct DB query failed, falling back to Supabase client:', dbErr.message);
      } finally {
        try {
          await pgClient.end();
        } catch (e) {}
      }
    }

    // Fallback to Supabase client queries if DB query was not successful
    if (!dbSuccess) {
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .single();

      if (userError) {
        console.error('[FirstBlood Webhook] Supabase user fetch error details:', userError);
      }
      username = user?.username || 'Unknown Player';

      const { data: challenge, error: challengeError } = await supabase
        .from('challenges')
        .select('title, category')
        .eq('id', challengeId)
        .single();

      if (challengeError) {
        console.error('[FirstBlood Webhook] Supabase challenge fetch error details:', challengeError);
        return NextResponse.json({ 
          error: `Supabase challenge fetch failed: ${challengeError.message}`
        }, { status: 500 });
      }

      if (!challenge) {
        return NextResponse.json({ error: 'Challenge details not found' }, { status: 404 });
      }

      challengeTitle = challenge.title || 'Unknown';
      challengeCategory = challenge.category || 'Unknown';

      try {
        const { data: teamMember } = await supabase
          .from('team_members')
          .select('teams(name)')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle();

        const resolvedTeam = (teamMember as any)?.teams?.name;
        if (resolvedTeam) {
          teamName = resolvedTeam.trim();
        }
      } catch (err) {
        console.error('[FirstBlood Webhook] Failed to fetch team info:', err);
      }
    }

    // 5. Send to Discord
    const embedTitle = isFirstBlood ? '🩸 FIRST BLOOD!' : '🚩 CHALLENGE SOLVED';
    const embedColor = isFirstBlood ? 15158332 : 3066993; // Red for first blood, Green for regular solve
    const embedDescription = isFirstBlood 
      ? 'A challenge has been solved for the first time!' 
      : 'A player has successfully solved a challenge!';

    const discordPayload = {
      embeds: [
        {
          title: embedTitle,
          description: embedDescription,
          color: embedColor,
          fields: [
            {
              name: '👤 Player',
              value: username,
              inline: true
            },
            {
              name: '👥 Team',
              value: teamName,
              inline: true
            },
            {
              name: '📂 Category',
              value: challengeCategory,
              inline: true
            },
            {
              name: '🚩 Challenge',
              value: `**${challengeTitle}**`,
              inline: true
            }
          ],
          timestamp: new Date().toISOString(),
          footer: {
            text: 'SCTF Platform Alert'
          }
        }
      ]
    };

    await sendDiscordNotification(discordPayload);

    console.log(`[FirstBlood Webhook] Sent Discord notification for ${username} on ${challengeTitle} (First Blood: ${isFirstBlood})`);
    return NextResponse.json({ 
      success: true, 
      message: isFirstBlood ? 'First blood notification sent to Discord' : 'Solve notification sent to Discord',
      isFirstBlood 
    });

  } catch (err: any) {
    console.error('[FirstBlood Webhook] Error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
