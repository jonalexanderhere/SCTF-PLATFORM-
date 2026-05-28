const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

// Load environment variables from .env.local or .env
const loadEnv = () => {
  const envPaths = ['.env.local', '.env'];
  for (const envPath of envPaths) {
    try {
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
          const match = line.match(/^([^=]+)=(.*)$/);
          if (match) {
            const key = match[1].trim();
            const val = match[2].trim().replace(/^["']|["']$/g, ''); // strip optional quotes
            process.env[key] = val;
          }
        });
        console.log(`[Discord Bot] Loaded environment from ${envPath}`);
        return;
      }
    } catch (err) {
      console.warn(`[Discord Bot] Failed to read ${envPath}:`, err.message);
    }
  }
};

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const botToken = process.env.DISCORD_BOT_TOKEN;
const channelId = process.env.DISCORD_CHANNEL_ID;
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

if (!supabaseUrl || !supabaseKey) {
  console.error('[Discord Bot] Missing Supabase credentials in environment.');
  process.exit(1);
}

if (!botToken && !webhookUrl) {
  console.error('[Discord Bot] Missing Discord Bot credentials (DISCORD_BOT_TOKEN) or Discord Webhook (DISCORD_WEBHOOK_URL) in environment.');
  process.exit(1);
}

if (botToken && !channelId) {
  console.error('[Discord Bot] Discord Bot Token is set, but DISCORD_CHANNEL_ID is missing.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ==============================================================
// Discord Gateway Connection (To keep the bot ONLINE permanently)
// ==============================================================
if (botToken) {
  let discordWs = null;
  let heartbeatInterval = null;
  let sequenceNumber = null;

  function connectToDiscordGateway() {
    console.log('[Discord Gateway] Connecting to gateway to keep bot status ONLINE...');
    
    try {
      discordWs = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
      
      discordWs.onopen = () => {
        console.log('[Discord Gateway] WebSocket connection opened.');
      };

      discordWs.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const { op, d, t, s } = payload;
          
          if (s !== undefined) sequenceNumber = s;

          // Opcode 10: HELLO (Sent by Discord immediately upon connecting)
          if (op === 10) {
            const { heartbeat_interval } = d;
            console.log('[Discord Gateway] HELLO received. Heartbeat interval:', heartbeat_interval);

            // Start sending heartbeats
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            heartbeatInterval = setInterval(() => {
              if (discordWs && discordWs.readyState === 1) { // OPEN
                discordWs.send(JSON.stringify({ op: 1, d: sequenceNumber }));
              }
            }, heartbeat_interval);

            // Send IDENTIFY payload to authenticate the bot
            console.log('[Discord Gateway] Sending IDENTIFY payload...');
            discordWs.send(JSON.stringify({
              op: 2,
              d: {
                token: botToken,
                intents: 513, // GUILDS + GUILD_MESSAGES
                properties: {
                  os: process.platform,
                  browser: 'SCTF-Platform-Bot',
                  device: 'SCTF-Platform-Bot'
                },
                presence: {
                  status: 'online',
                  activities: [{
                    name: 'First Bloods 🩸',
                    type: 3 // Watching
                  }],
                  afk: false
                }
              }
            }));
          }

          // Opcode 11: HEARTBEAT ACK
          if (op === 11) {
            // Heartbeat acknowledged by Discord
          }

          // Dispatch Event: READY (Bot is fully connected and authenticated)
          if (op === 0 && t === 'READY') {
            console.log(`[Discord Gateway] Bot is now ONLINE as: ${d.user.username}#${d.user.discriminator}`);
          }

        } catch (err) {
          console.error('[Discord Gateway] Error parsing message:', err.message);
        }
      };

      discordWs.onclose = (event) => {
        console.warn(`[Discord Gateway] Connection closed (Code: ${event.code}). Reconnecting in 5s...`);
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        setTimeout(connectToDiscordGateway, 5000);
      };

      discordWs.onerror = (err) => {
        console.error('[Discord Gateway] WebSocket error:', err.message || err);
      };

    } catch (err) {
      console.error('[Discord Gateway] Failed to initialize WebSocket:', err.message);
      setTimeout(connectToDiscordGateway, 5000);
    }
  }

  // Start Gateway Connection
  connectToDiscordGateway();
}

// ==============================================================
// Discord Notification Dispatcher
// ==============================================================
async function sendDiscordNotification(payload) {
  if (botToken && channelId) {
    console.log('[Discord Bot] Sending via Bot Token to channel:', channelId);
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
    console.log('[Discord Bot] Sending via Webhook URL');
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
  }
}

// ==============================================================
// Supabase solves Insert Listener
// ==============================================================
console.log('[Discord Bot] Subscribing to solves table INSERT events...');

const channel = supabase
  .channel('discord-firstblood-listener')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'solves' }, async (payload) => {
    try {
      const solve = payload.new;
      if (!solve || !solve.challenge_id || !solve.user_id) {
        console.log('[Discord Bot] Invalid solve event payload:', payload);
        return;
      }

      console.log(`[Discord Bot] New solve detected! Solve ID: ${solve.id}, Challenge ID: ${solve.challenge_id}`);

      // 1. Check if first blood
      const { data: solves, error: solvesError } = await supabase
        .from('solves')
        .select('id, user_id, created_at')
        .eq('challenge_id', solve.challenge_id)
        .order('created_at', { ascending: true });

      if (solvesError || !solves || solves.length === 0) {
        console.warn('[Discord Bot] Failed to fetch solves list:', solvesError);
        return;
      }

      const isFirstBlood = solves[0].id === solve.id;
      console.log(`[Discord Bot] Solve detected (First Blood: ${isFirstBlood}). Preparing Discord embed...`);

      // 2. Fetch Details (User, Challenge, Team)
      let username = 'Unknown';
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
          `, [solve.user_id, solve.challenge_id]);

          if (dbRes.rows.length > 0) {
            const row = dbRes.rows[0];
            username = row.username || 'Unknown';
            challengeTitle = row.challenge_title || 'Unknown';
            challengeCategory = row.challenge_category || 'Unknown';
            teamName = row.team_name ? row.team_name.trim() : '-';
            dbSuccess = true;
          }
        } catch (dbErr) {
          console.error('[Discord Bot] Direct DB query failed, falling back to Supabase client:', dbErr.message);
        } finally {
          try {
            await pgClient.end();
          } catch (e) {}
        }
      }

      // Fallback to Supabase client queries if DB query was not successful
      if (!dbSuccess) {
        const { data: user } = await supabase
          .from('users')
          .select('username')
          .eq('id', solve.user_id)
          .single();
        
        username = user ? user.username : 'Unknown';

        const { data: challenge } = await supabase
          .from('challenges')
          .select('title, category')
          .eq('id', solve.challenge_id)
          .single();

        if (!challenge) {
          console.warn('[Discord Bot] Challenge not found. ID:', solve.challenge_id);
          return;
        }

        challengeTitle = challenge.title || 'Unknown';
        challengeCategory = challenge.category || 'Unknown';

        try {
          const { data: teamMember } = await supabase
            .from('team_members')
            .select('teams(name)')
            .eq('user_id', solve.user_id)
            .limit(1)
            .maybeSingle();

          const resolvedTeam = teamMember?.teams?.name;
          if (resolvedTeam) {
            teamName = resolvedTeam.trim();
          }
        } catch (err) {
          console.error('[Discord Bot] Failed to resolve team name:', err.message);
        }
      }

      // 5. Send Discord Embed
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
      console.log(`[Discord Bot] Successfully sent solve alert to Discord for player "${username}" on challenge "${challengeTitle}" (First Blood: ${isFirstBlood})`);

    } catch (err) {
      console.error('[Discord Bot] Error handling solve change:', err.message);
    }
  })
  .subscribe((status) => {
    console.log(`[Discord Bot] Supabase subscription status: ${status}`);
  });

// Keep process alive
console.log('[Discord Bot] Standalone Listener with Gateway is running. Press Ctrl+C to exit.');
setInterval(() => {}, 60000);
