const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Manual env parser to read config from .env.local if present
try {
  if (fs.existsSync('.env.local')) {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[match[1].trim()] = val;
      }
    });
  }
} catch (err) {
  console.warn("Could not read .env.local file:", err.message);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY in environment or .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function main() {
  console.log("Fetching all users from auth.users...");
  const { data: { users: authUsers }, error: authError } = await supabase.auth.admin.listUsers({
    limit: 1000
  });

  if (authError) {
    console.error("Error fetching auth users:", authError.message);
    return;
  }

  console.log(`Found ${authUsers.length} users in auth.users.`);

  console.log("Fetching all users from public.users...");
  const { data: publicUsers, error: publicError } = await supabase
    .from('users')
    .select('*');

  if (publicError) {
    console.error("Error fetching public users:", publicError.message);
    return;
  }

  console.log(`Found ${publicUsers.length} users in public.users.`);

  const publicUsersMap = new Map(publicUsers.map(u => [u.id, u]));
  const existingUsernames = new Set(publicUsers.map(u => u.username.toLowerCase()));

  const missingUsers = [];
  for (const au of authUsers) {
    if (!publicUsersMap.has(au.id)) {
      missingUsers.push(au);
    }
  }

  console.log(`\nFound ${missingUsers.length} users missing public profiles:`);

  for (const mu of missingUsers) {
    let baseUsername = mu.user_metadata?.username || 
                       mu.user_metadata?.display_name || 
                       (mu.email ? mu.email.split('@')[0] : `user_${mu.id.substring(0, 8)}`);
    
    baseUsername = baseUsername.trim();
    
    let username = baseUsername;
    let suffix = 1;
    while (existingUsernames.has(username.toLowerCase())) {
      username = `${baseUsername}_${suffix}`;
      suffix++;
    }

    console.log(`- Auth ID: ${mu.id} | Email: ${mu.email} | Selected Username: ${username}`);
    existingUsernames.add(username.toLowerCase());

    const { error: insertError } = await supabase
      .from('users')
      .insert({
        id: mu.id,
        username: username,
        created_at: mu.created_at,
        updated_at: mu.created_at
      });

    if (insertError) {
      console.error(`  Error creating profile for ${mu.id}:`, insertError.message);
    } else {
      console.log(`  Successfully created profile for ${username}!`);
    }
  }

  console.log("\nSync completed!");
}

main().catch(err => console.error(err));
