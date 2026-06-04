import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/const';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function sendDiscordNotification(payload: any) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (botToken && channelId) {
    console.log('[Wave Webhook] Sending via Discord Bot Token to channel:', channelId);
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
    console.log('[Wave Webhook] Sending via Discord Webhook URL');
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
    console.log('[Wave Webhook] Discord credentials missing. Skipping Discord notification.');
    return false;
  }
}

export async function POST(request: Request) {
  try {
    // 1. Authorize Admin
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

    // 2. Parse payload
    const body = await request.json();
    const { eventId, action, isPaused, waveNumber, wavesCount } = body;

    if (!eventId) {
      return NextResponse.json({ error: 'Missing eventId' }, { status: 400 });
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return NextResponse.json({ error: 'Server configuration error: service role key missing' }, { status: 500 });
    }

    const serviceSupabase = createClient(SUPABASE_URL, serviceRoleKey);

    // Fetch the event
    const { data: event, error: eventFetchErr } = await serviceSupabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (eventFetchErr || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // 3. Process Action
    if (action === 'toggle-pause') {
      const { data, error } = await serviceSupabase
        .from('events')
        .update({ is_paused: !!isPaused })
        .eq('id', eventId)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, event: data });

    } else if (action === 'open-wave') {
      const activeWaves = event.active_waves || [];
      const waveNum = parseInt(waveNumber, 10);
      if (isNaN(waveNum)) {
        return NextResponse.json({ error: 'Invalid waveNumber' }, { status: 400 });
      }

      if (!activeWaves.includes(waveNum)) {
        const newWaves = [...activeWaves, waveNum].sort((a: number, b: number) => a - b);
        const { data, error } = await serviceSupabase
          .from('events')
          .update({ active_waves: newWaves })
          .eq('id', eventId)
          .select()
          .single();

        if (error) throw error;

        // Trigger Discord Announcement for opening wave
        try {
          const embedPayload = {
            embeds: [
              {
                title: "🌊 NEW WAVE UNLOCKED! 🌊",
                description: `### Event: **${event.name}**\n\n**Wave ${waveNum}** has been officially opened by the administrator!\n\nNew challenges are now unlocked and open for submissions. Good luck hackers! 🚀`,
                color: 39423,
                footer: {
                  text: "SCTF Platform Announcement"
                },
                timestamp: new Date().toISOString()
              }
            ]
          };
          await sendDiscordNotification(embedPayload);
        } catch (discordErr) {
          console.error('[Wave Announcement] Discord notification failed:', discordErr);
        }

        return NextResponse.json({ success: true, event: data, announced: true });
      }

      return NextResponse.json({ success: true, event, announced: false, message: 'Wave already open' });

    } else if (action === 'close-wave') {
      const activeWaves = event.active_waves || [];
      const waveNum = parseInt(waveNumber, 10);
      if (isNaN(waveNum)) {
        return NextResponse.json({ error: 'Invalid waveNumber' }, { status: 400 });
      }

      const newWaves = activeWaves.filter((w: number) => w !== waveNum).sort((a: number, b: number) => a - b);
      const { data, error } = await serviceSupabase
        .from('events')
        .update({ active_waves: newWaves })
        .eq('id', eventId)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, event: data });

    } else if (action === 'update-waves-count') {
      const wavesCountNum = parseInt(wavesCount, 10);
      if (isNaN(wavesCountNum) || wavesCountNum < 1) {
        return NextResponse.json({ error: 'Invalid wavesCount' }, { status: 400 });
      }

      const { data, error } = await serviceSupabase
        .from('events')
        .update({ waves_count: wavesCountNum })
        .eq('id', eventId)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, event: data });

    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

  } catch (err: any) {
    console.error('[EventAction API] Error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
