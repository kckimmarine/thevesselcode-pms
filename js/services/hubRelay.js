/* Hub Relay — Station leg (sync_status) vs Master Hub leg (hub_sync_status) */
const TVC_HubRelay = (function () {
    const SYNCED = 'SYNCED';

    function isCaptainHub(user) {
        return typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user);
    }

    function isStationPc(user) {
        return typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user);
    }

    function isHubRelayExport(user) {
        return isCaptainHub(user) && !(typeof TVC_RBAC !== 'undefined' && TVC_RBAC.isHqAccount(user));
    }

    function isStationSynced(row) {
        return row?.sync_status === SYNCED;
    }

    function isHubSynced(row) {
        return row?.hub_sync_status === SYNCED;
    }

    /** Station: Confirmed && sync_status ≠ SYNCED */
    function canStationLegExport(row) {
        return !!row && !isStationSynced(row);
    }

    /** Master Hub: sync_status = SYNCED && hub_sync_status ≠ SYNCED */
    function canHubLegExport(row) {
        return !!row && isStationSynced(row) && !isHubSynced(row);
    }

    function canRelayLegExport(user, row) {
        if (isHubRelayExport(user)) return canHubLegExport(row);
        return canStationLegExport(row);
    }

    function stampStationExport(row) {
        if (!row) return row;
        row.sync_status = SYNCED;
        row.last_synced_at = new Date().toISOString();
        return row;
    }

    function stampHubExport(row) {
        if (!row) return row;
        row.hub_sync_status = SYNCED;
        row.hub_synced_at = new Date().toISOString();
        return row;
    }

    function stampExport(user, row) {
        if (isHubRelayExport(user)) return stampHubExport(row);
        return stampStationExport(row);
    }

    function filterStationPending(rows) {
        return (rows || []).filter(r => !isStationSynced(r));
    }

    function filterHubPending(rows) {
        return (rows || []).filter(r => isStationSynced(r) && !isHubSynced(r));
    }

    function filterRelayPending(user, rows) {
        if (isHubRelayExport(user)) return filterHubPending(rows);
        return filterStationPending(rows);
    }

    function stationExportBlockedTitle() {
        return 'Already exported (Submitted)';
    }

    function hubExportBlockedTitle() {
        return 'Already exported to Company (Submitted)';
    }

    function relayExportBlockedTitle(user) {
        return isHubRelayExport(user) ? hubExportBlockedTitle() : stationExportBlockedTitle();
    }

    return {
        SYNCED,
        isCaptainHub,
        isStationPc,
        isHubRelayExport,
        isStationSynced,
        isHubSynced,
        canStationLegExport,
        canHubLegExport,
        canRelayLegExport,
        stampStationExport,
        stampHubExport,
        stampExport,
        filterStationPending,
        filterHubPending,
        filterRelayPending,
        stationExportBlockedTitle,
        hubExportBlockedTitle,
        relayExportBlockedTitle,
    };
})();

if (typeof window !== 'undefined') window.TVC_HubRelay = TVC_HubRelay;
