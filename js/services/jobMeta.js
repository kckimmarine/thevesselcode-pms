/* Work Procedure, History, Attachments per Job Code */
const TVC_JobMeta = (function () {
    const KEY = 'tvc_job_meta';

    function loadAll() {
        try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
        catch { return {}; }
    }

    function saveAll(data) {
        localStorage.setItem(KEY, JSON.stringify(data));
    }

    function ensure(jobCode) {
        const all = loadAll();
        if (!all[jobCode]) {
            all[jobCode] = {
                procedure: '',
                history: [],
                attachments: [],
                free_reports: [],
            };
        }
        return all[jobCode];
    }

    function get(jobCode) {
        return ensure(jobCode);
    }

    function setProcedure(jobCode, text) {
        const all = loadAll();
        const m = ensure(jobCode);
        m.procedure = text;
        all[jobCode] = m;
        saveAll(all);
    }

    function addHistory(jobCode, entry) {
        const all = loadAll();
        const m = ensure(jobCode);
        m.history.unshift({
            id: Date.now(),
            date: new Date().toLocaleString(),
            ...entry,
        });
        all[jobCode] = m;
        saveAll(all);
    }

    function addAttachment(jobCode, file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const all = loadAll();
                const m = ensure(jobCode);
                m.attachments.push({
                    id: Date.now(),
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    dataUrl: reader.result,
                    uploaded_at: new Date().toISOString(),
                });
                all[jobCode] = m;
                saveAll(all);
                resolve(m.attachments[m.attachments.length - 1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function getHistoryForJob(jobCode) {
        const meta = get(jobCode);
        const reports = [];
        return { procedure: meta.procedure, history: meta.history, attachments: meta.attachments };
    }

    return { get, setProcedure, addHistory, addAttachment, getHistoryForJob };
})();
