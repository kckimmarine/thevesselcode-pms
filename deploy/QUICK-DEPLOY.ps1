# THE VESSEL CODE — Vercel deploy (run from repo root)
# Prerequisites: GitHub repo + vercel.com account (free)

Write-Host ""
Write-Host "TVC-PMS Web Deploy" -ForegroundColor Cyan
Write-Host "==================" 
Write-Host ""
Write-Host "1. GitHub (first time only):"
Write-Host "   git init"
Write-Host "   git add vercel.json js/config.js index.html js/auth.js css/app.css deploy/ downloads/ .vercelignore"
Write-Host "   git commit -m 'Web HQ demo deploy'"
Write-Host "   gh repo create thevesselcode-pms --private --source=. --push"
Write-Host ""
Write-Host "2. Vercel: https://vercel.com/new -> Import GitHub repo"
Write-Host "   Framework: Other | Output: . | Deploy"
Write-Host ""
Write-Host "3. Bluehost PMS tab:"
Write-Host "   Upload bluehost/pms/index.html -> public_html/pms/index.html"
Write-Host "   Homepage nav link: https://thevesselcode.com/pms/"
Write-Host ""
Write-Host "4. Domain: Vercel Settings -> Domains -> app.thevesselcode.com"
Write-Host "   Bluehost DNS: CNAME app -> cname.vercel-dns.com"
Write-Host ""
Write-Host "5. Setup.exe: copy dist/*.exe to downloads/ then git push"
Write-Host ""
Write-Host "Local preview NOW: double-click START-WEB-DEMO.bat"
Write-Host "  dm_user@thevesselcode.com / 0000  (TVC HQ)"
Write-Host "  admin / (Super Admin — password in js/auth.js seed_password)"
Write-Host ""

if (Get-Command npx -ErrorAction SilentlyContinue) {
    $reply = Read-Host "Run npx vercel login + deploy now? (y/N)"
    if ($reply -eq 'y') {
        npx --yes vercel login
        npx --yes vercel --prod
    }
}
