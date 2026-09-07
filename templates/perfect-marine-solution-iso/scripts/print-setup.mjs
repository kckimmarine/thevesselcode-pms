#!/usr/bin/env node
/**
 * Print one-time Supabase setup steps for PMS ISO online mode.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = readFileSync(join(root, 'deploy/supabase-schema.sql'), 'utf8');
const storage = readFileSync(join(root, 'deploy/supabase-storage.sql'), 'utf8');

console.log(`
=== PERFECT MARINE SOLUTION — ISO Online Setup ===

1. Create a NEW Supabase project (separate from TVC-PMS).

2. SQL Editor → paste and run:
   deploy/supabase-schema.sql

3. Storage → New bucket: iso-evidence (Private)

4. SQL Editor → run:
   deploy/supabase-storage.sql

5. Authentication → Users → Add user (email/password)

6. SQL Editor → link profile (use user UUID from Auth):
   INSERT INTO iso_profiles (id, display_name, role)
   VALUES ('<USER_UUID>', 'Quality Lead', 'admin');

7. Project Settings → API → copy URL + anon key into:
   deploy/.env.local (from deploy/.env.example)
   portal/js/config.js

8. Local: npm start → http://localhost:3010

9. Vercel: New project, Root Directory = portal (or repo root + see README)
   Env: optional meta injection via build script

--- deploy/supabase-schema.sql (preview) ---
`);
console.log(schema.slice(0, 800) + '\n...\n');
