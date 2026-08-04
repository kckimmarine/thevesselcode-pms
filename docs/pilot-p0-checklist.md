# Pilot P0 Checklist — Vessel 3식 + HQ Menu ZIP

Target: **INCHEON CHEMI** (Master / Engine / Deck) + **Daemyung HQ**  
Transfer: offline ZIP only  
License: SKU + PC bind (`npm run dist` packages)

## Install / License

- [ ] Install Master / Engine / Deck / HQ packages on clean PCs
- [ ] First launch binds `license.json` to that PC (`%AppData%/tvc-pms-<SKU>/`)
- [ ] Login badge shows SKU · vessel · expiry
- [ ] Copying app folder to another PC → license machine error
- [ ] Vessel SKU rejects HQ (`hq`) login; HQ SKU rejects Master/Deck/Engine dept login mismatch

## Vessel Engine / Deck

- [ ] Login with allowed accounts only (Engine: engineer/ce · Deck: officer/co)
- [ ] Menu → Export Monthly / Defect / Postpone (as applicable)
- [ ] Export ZIP filename contains `INCHEON CHEMI`
- [ ] Import HQ feedback ZIP of matching vessel succeeds
- [ ] Import ZIP for another vesselId fails

## Vessel Master (Captain Hub)

- [ ] Import Engine + Deck station ZIPs
- [ ] Export Company / Monthly report ZIP to HQ
- [ ] Import HQ feedback ZIP

## HQ Office

- [ ] Select fleet vessel **INCHEON CHEMI**
- [ ] Import ship Monthly / Defect / Postpone ZIPs
- [ ] Approve / reply paths used in Pilot SOP
- [ ] Export HQ feedback ZIPs back to ship
- [ ] Import with wrong fleet selection fails vessel check

## Smoke

- [ ] Each PC: install → license OK → login → one Export + one Import
- [ ] Browser `npm start` still works for development (license not enforced)
