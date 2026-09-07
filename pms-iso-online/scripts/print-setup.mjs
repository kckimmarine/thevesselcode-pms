#!/usr/bin/env node
console.log(`
=== PERFECT MARINE SOLUTION — ISO Online Setup ===

Full guide: docs/SUPABASE-SETUP.md

Quick path:
  1. supabase.com/dashboard → New project "pms-iso"
  2. cp deploy/.env.example deploy/.env.local
  3. Fill SUPABASE_URL, keys, DATABASE_URL (+ optional admin email/password)
  4. npm run setup:apply
  5. npm start → http://localhost:3010

Automated (setup:apply): schema, RLS, bucket, portal/js/config.js, admin user
`);
