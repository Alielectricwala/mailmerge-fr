import 'dotenv/config';
import prisma from '../src/server/db.js';

const tables = [
  'audit_logs',
  'auth_tokens',
  'campaign_members',
  'campaign_recipient_overrides',
  'campaign_rules',
  'campaign_templates',
  'campaigns',
  'contact_lists',
  'contacts',
  'enrichments',
  'import_batches',
  'send_events',
  'sends',
  'sessions',
  'settings',
  'suppression_entries',
  'templates',
  'users',
];

async function main() {
  console.log('Enabling Row Level Security (RLS) on all public tables...');

  for (const table of tables) {
    console.log(`Processing ${table}...`);
    // 1. Enable RLS
    await prisma.$executeRawUnsafe(`ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY;`);

    // 2. Drop existing policy if exists to make it idempotent
    await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS "service_role_all_${table}" ON "public"."${table}";`);
    await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS "authenticated_all_${table}" ON "public"."${table}";`);

    // 3. Grant full access to service_role (used by backend/Supabase API keys)
    await prisma.$executeRawUnsafe(`
      CREATE POLICY "service_role_all_${table}"
      ON "public"."${table}"
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
    `);

    // 4. Grant full access to authenticated users
    await prisma.$executeRawUnsafe(`
      CREATE POLICY "authenticated_all_${table}"
      ON "public"."${table}"
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
    `);
  }

  console.log('Successfully enabled RLS and applied permissions to all tables!');
}

main()
  .catch((err) => {
    console.error('Error applying RLS:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
