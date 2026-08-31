# THE VESSEL CODE — Online sync pilot setup (INCHEON CHEMI only)
# Run from repo root. Completes Supabase + Vercel steps that cannot be done from code alone.

$ErrorActionPreference = 'Stop'
$PilotVessel = 'INCHEON CHEMI'
$SyncApiBase = 'https://app.thevesselcode.com'

Write-Host ''
Write-Host 'TVC-PMS Online Sync — Pilot Setup' -ForegroundColor Cyan
Write-Host "Test vessel: $PilotVessel only (no other vessels in Supabase seed)" -ForegroundColor Yellow
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''

Write-Host 'Step 1 — Supabase project' -ForegroundColor Green
Write-Host '  https://supabase.com/dashboard -> New project (or open existing)'
Write-Host ''

Write-Host 'Step 2 — SQL (INCHEON CHEMI only)' -ForegroundColor Green
Write-Host '  SQL Editor -> paste and run:'
Write-Host "  deploy\supabase-sync-pilot-incheon-chemi.sql"
Write-Host ''

Write-Host 'Step 3 — Storage bucket' -ForegroundColor Green
Write-Host '  Storage -> New bucket'
Write-Host '    Name: tvc-sync-packages'
Write-Host '    Public: OFF (private)'
Write-Host ''

Write-Host 'Step 4 — Vercel environment variables' -ForegroundColor Green
Write-Host '  https://vercel.com -> thevesselcode-pms -> Settings -> Environment Variables'
Write-Host '  Add for Production (and Preview if needed):'
Write-Host '    SUPABASE_URL              = https://xxxx.supabase.co'
Write-Host '    SUPABASE_SERVICE_ROLE_KEY = (service_role key from Supabase API settings)'
Write-Host "    SYNC_PILOT_VESSEL_ID      = $PilotVessel"
Write-Host '  Then Redeploy the latest production deployment.'
Write-Host ''

Write-Host 'Automated setup (after deploy/.env.deploy.local is filled):'
Write-Host '  npm run setup-online-sync'
Write-Host ''
Write-Host '  npm run verify-online-sync'
Write-Host '  Expected when configured with no packages yet: HTTP 404 NOT_FOUND for INCHEON CHEMI'
Write-Host ''

Write-Host 'Step 6 — App test flow' -ForegroundColor Green
Write-Host '  Master (Electron, captain / 0000): Data Export & Import -> Push to HQ (online)'
Write-Host '  HQ (dm_user@thevesselcode.com / 0000): select INCHEON CHEMI -> Pull from vessel (online)'
Write-Host '  HQ: review -> Push reply to vessel (online)'
Write-Host '  Master: Pull HQ reply (online)'
Write-Host '  FBB / low bandwidth: continue using Export/Import ZIP.'
Write-Host ''

$runVerify = Read-Host 'Run verify-online-sync now? (y/N)'
if ($runVerify -eq 'y') {
    npm run verify-online-sync
}
