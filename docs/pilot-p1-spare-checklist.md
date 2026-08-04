# Pilot P1 Checklist — SPARE Quotation / Xfer / Inventory

## HQ SPARE Export

- [ ] Data Export & Import → Export shows **Quotation / Evaluation / Order / Inventory**
- [ ] Quotation export list → Excel download logs History **Quotation**
- [ ] Evaluation (Reply Evaluation) export logs **Evaluation**
- [ ] Order (Purchase Order) export logs **Order**
- [ ] Inventory CSV export logs **Inventory**

## Vessel SPARE Import

- [ ] Import shows **Evaluation / Inventory** only
- [ ] Evaluation: `*_EVAL*.xlsx` / Assessment `.json` accepted
- [ ] Inventory: `.xls / .xlsx / .csv` accepted
- [ ] Wrong type after selection shows clear error

## History tabs

- [ ] HQ History: Requisition / Quotation / Evaluation / Order / Received / Inventory
- [ ] Vessel History: Requisition / Evaluation / Received / Inventory
- [ ] Rows appear under the matching tab after Export/Import

## Quotation workflow (one loop)

- [ ] HQ: Request Quote → Export Quotation
- [ ] Vessel: Import Evaluation (or process evaluation reply)
- [ ] HQ: Export Evaluation / Order as required by SOP
- [ ] Inventory update on vessel → Export Inventory → HQ Import Inventory (if used in Pilot)

## SPARE Master

- [ ] If Pilot needs master migration: Database Backup & Restore / PMS Master Excel path verified
- [ ] If not needed for Pilot: defer to P2

## License guards

- [ ] SPARE Inventory export blocked when vessel not licensed
- [ ] Packages carry / respect `company_id: DAEMYUNG` where applicable
