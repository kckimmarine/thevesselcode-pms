-- Sample data (users are created by scripts/demo-rbac.js with real password hashes)

INSERT OR IGNORE INTO Ship_Components (id, parent_id, machinery_name, component_name, node_type, total_running_hours, sort_order)
VALUES
    ('sc-me-root',     NULL,          'M/E',   'Main Engine',    'MACHINERY',     12450, 1),
    ('sc-me-exhaust',  'sc-me-root',  'M/E',   'Exhaust Valve',  'COMPONENT',     12450, 2),
    ('sc-me-injector', 'sc-me-root',  'M/E',   'Fuel Injector',  'COMPONENT',     12450, 3),
    ('sc-ge1-root',    NULL,          'G/E 1', 'No.1 Aux Engine','MACHINERY',      4820, 4),
    ('sc-ge1-piston',  'sc-ge1-root', 'G/E 1', 'Piston',         'COMPONENT',      4820, 5);

INSERT OR IGNORE INTO Spare_Parts (id, part_no, name, qty_on_hand, min_qty)
VALUES
    ('sp-01', 'ME-EX-001', 'Exhaust Valve Spindle',       2, 2),
    ('sp-02', 'ME-FI-012', 'Fuel Injector Nozzle Tips',   4, 6),
    ('sp-03', 'AE-PR-04',  'G/E Piston Ring Set',         3, 2);

INSERT OR IGNORE INTO Maintenance_Jobs (
    id, ship_component_id, job_code, description, period, unit, pic,
    last_done_hours, next_due_hours, plan_status, spare_part_id, spare_use_qty
)
VALUES
    ('job-01', 'sc-me-exhaust',  '01-004', 'Overhaul & Grinding',    5000, 'H', 'C/E', 8000,  13000, 'DUE_SOON', 'sp-01', 1),
    ('job-02', 'sc-me-injector', '01-008', 'Nozzle Replacement',     3000, 'H', '2/E', 12000, 15000, 'PLANNED',  'sp-02', 6),
    ('job-03', 'sc-ge1-piston',  '02-001', 'Piston Ring Renewal',    8000, 'H', '3/E', 0,     8000,  'OVERDUE',  'sp-03', 1);
