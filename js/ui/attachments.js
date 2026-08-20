/** TVC-PMS — attachment preview / download (data URL blobs in IndexedDB) */
const TVC_Attachments = (function () {
    const registry = new Map();
    let previewRef = null;
    let previewObjectUrl = null;

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function escAttr(s) { return esc(s); }

    function register(attachment) {
        if (!attachment) return '';
        const id = String(attachment.id || `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        registry.set(id, attachment);
        return id;
    }

    function resolve(ref) {
        if (!ref) return null;
        if (typeof ref === 'object') return ref;
        return registry.get(String(ref)) || null;
    }

    function fileExt(name) {
        const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
        return m ? m[1] : '';
    }

    function mimeType(attachment) {
        const raw = String(attachment?.type || '').trim().toLowerCase();
        if (raw && raw !== 'application/octet-stream') return raw;
        const ext = fileExt(attachment?.name);
        const map = {
            jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
            webp: 'image/webp', bmp: 'image/bmp', pdf: 'application/pdf',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            doc: 'application/msword',
            xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            xls: 'application/vnd.ms-excel', csv: 'text/csv',
        };
        if (ext && map[ext]) return map[ext];
        const du = String(attachment?.dataUrl || '');
        const m = du.match(/^data:([^;,]+)/i);
        return m ? m[1].toLowerCase() : '';
    }

    function isWordAttachment(attachment) {
        const mime = mimeType(attachment);
        const ext = fileExt(attachment?.name);
        return ext === 'docx' || ext === 'doc'
            || mime.includes('wordprocessingml') || mime === 'application/msword';
    }

    function isExcelAttachment(attachment) {
        const mime = mimeType(attachment);
        const ext = fileExt(attachment?.name);
        return ext === 'xlsx' || ext === 'xls' || ext === 'csv'
            || mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel'
            || mime === 'text/csv';
    }

    function isPreviewable(attachment) {
        const mime = mimeType(attachment);
        if (mime.startsWith('image/')) return true;
        if (mime === 'application/pdf') return true;
        if (isWordAttachment(attachment)) return fileExt(attachment?.name) === 'docx';
        if (isExcelAttachment(attachment)) return true;
        const name = String(attachment?.name || '').toLowerCase();
        return /\.(jpe?g|png|gif|webp|bmp|pdf|docx|xlsx|xls|csv)$/.test(name);
    }

    function dataUrlToArrayBuffer(dataUrl) {
        const blob = dataUrlToBlob(dataUrl);
        return blob.arrayBuffer();
    }

    function dataUrlToBlob(dataUrl) {
        const parts = String(dataUrl || '').split(',');
        if (parts.length < 2) throw new Error('Invalid attachment data.');
        const header = parts[0];
        const b64 = parts.slice(1).join(',');
        const mime = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
        const binary = atob(b64);
        const arr = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
        return new Blob([arr], { type: mime });
    }

    function revokePreviewObjectUrl() {
        if (previewObjectUrl) {
            URL.revokeObjectURL(previewObjectUrl);
            previewObjectUrl = null;
        }
    }

    function objectUrlForAttachment(attachment) {
        revokePreviewObjectUrl();
        const blob = dataUrlToBlob(attachment.dataUrl);
        previewObjectUrl = URL.createObjectURL(blob);
        return previewObjectUrl;
    }

    function ensurePreviewModal() {
        let modal = document.getElementById('tvcAttachPreviewModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'tvcAttachPreviewModal';
        modal.className = 'modal hidden tvc-attach-preview-modal';
        modal.innerHTML = `
            <div class="modal-box tvc-attach-preview-box">
                <button type="button" class="modal-x" onclick="TVC_Attachments.closePreview()" aria-label="Close">×</button>
                <h3 class="tvc-attach-preview-title" id="tvcAttachPreviewTitle"></h3>
                <div class="tvc-attach-preview-body" id="tvcAttachPreviewBody"></div>
                <div class="modal-actions tvc-attach-preview-actions">
                    <button type="button" class="btn btn-sm" id="tvcAttachPreviewDownloadBtn" onclick="TVC_Attachments.downloadCurrent()">Download</button>
                    <button type="button" class="btn btn-sm" onclick="TVC_Attachments.closePreview()">Close</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        return modal;
    }

    async function docxToHtml(arrayBuffer) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip is not loaded.');
        const zip = await JSZip.loadAsync(arrayBuffer);
        const xml = await zip.file('word/document.xml')?.async('string');
        if (!xml) throw new Error('Invalid Word document.');
        const blocks = xml.split(/<w:p\b[^>]*>/).slice(1);
        const parts = blocks.map(block => {
            const texts = [...block.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
                .map(m => esc(m[1])).join('');
            return texts ? `<p>${texts}</p>` : '';
        }).filter(Boolean);
        return parts.length
            ? `<div class="tvc-attach-preview-doc">${parts.join('')}</div>`
            : '<p class="muted tvc-attach-preview-fallback">(Empty document)</p>';
    }

    async function excelToHtml(arrayBuffer, filename) {
        const ext = fileExt(filename);
        if (ext === 'csv') {
            const text = new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer));
            const rows = text.split(/\r?\n/).filter(Boolean).slice(0, 500);
            const body = rows.map(row => {
                const cells = row.split(',').map(c => `<td>${esc(c.trim())}</td>`).join('');
                return `<tr>${cells}</tr>`;
            }).join('');
            return `<div class="tvc-attach-preview-sheet"><table class="tvc-attach-preview-table"><tbody>${body}</tbody></table></div>`;
        }
        if (typeof XLSX === 'undefined') throw new Error('XLSX library is not loaded.');
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) return '<p class="muted">(Empty workbook)</p>';
        const html = XLSX.utils.sheet_to_html(wb.Sheets[sheetName], { editable: false });
        return `<div class="tvc-attach-preview-sheet">${html}</div>`;
    }

    async function buildPreviewContent(attachment) {
        const mime = mimeType(attachment);
        const name = attachment.name || '';
        const url = objectUrlForAttachment(attachment);

        if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(name)) {
            return `<img class="tvc-attach-preview-img" src="${escAttr(url)}" alt="${esc(name)}">`;
        }
        if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
            return `<iframe class="tvc-attach-preview-frame" src="${escAttr(url)}" title="${esc(name)}"></iframe>`;
        }
        const buf = await dataUrlToArrayBuffer(attachment.dataUrl);
        if (isWordAttachment(attachment)) {
            if (fileExt(name) === 'doc') {
                return '<p class="muted tvc-attach-preview-fallback">Legacy .doc preview is not supported. Use Download.</p>';
            }
            return await docxToHtml(buf);
        }
        if (isExcelAttachment(attachment)) {
            return await excelToHtml(buf, name);
        }
        return '<p class="muted tvc-attach-preview-fallback">Preview is not available for this file type. Use Download.</p>';
    }

    async function preview(ref) {
        const attachment = resolve(ref);
        if (!attachment?.dataUrl) return;
        previewRef = attachment;
        const modal = ensurePreviewModal();
        const title = document.getElementById('tvcAttachPreviewTitle');
        const body = document.getElementById('tvcAttachPreviewBody');
        if (title) title.textContent = attachment.name || 'Attachment';
        if (body) body.innerHTML = '<p class="muted tvc-attach-preview-loading">Loading preview…</p>';
        document.body.appendChild(modal);
        modal.classList.remove('hidden');
        try {
            if (body) body.innerHTML = await buildPreviewContent(attachment);
        } catch (e) {
            if (body) {
                body.innerHTML = `<p class="muted tvc-attach-preview-fallback">${esc(e.message || 'Preview failed. Use Download.')}</p>`;
            }
        }
    }

    function closePreview() {
        const modal = document.getElementById('tvcAttachPreviewModal');
        if (modal) modal.classList.add('hidden');
        const body = document.getElementById('tvcAttachPreviewBody');
        if (body) body.innerHTML = '';
        revokePreviewObjectUrl();
        previewRef = null;
    }

    async function download(ref) {
        const attachment = resolve(ref);
        if (!attachment?.dataUrl) return;
        try {
            const blob = dataUrlToBlob(attachment.dataUrl);
            const filename = attachment.name || 'attachment';
            if (typeof TVC_FileExport !== 'undefined' && TVC_FileExport.save) {
                await TVC_FileExport.save(blob, filename);
                return;
            }
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            if (typeof TVC_Dialog !== 'undefined') {
                await TVC_Dialog.alert(e.message || 'Download failed.');
            }
        }
    }

    function downloadCurrent() {
        if (previewRef) download(previewRef);
    }

    function renderListItemHtml(attachment, options = {}) {
        const { forPrint = false, canRemove = false, removeOnclick = '' } = options;
        const id = register(attachment);
        const name = esc(attachment.name || 'file');
        const sizeKb = Math.max(1, Math.round((attachment.size || 0) / 1024));
        if (forPrint) {
            return `<li class="wr-attach-item">
                <span class="wr-attach-link">📎 ${name}</span>
                <span class="wr-attach-size">${sizeKb}KB</span>
            </li>`;
        }
        const previewBtn = isPreviewable(attachment)
            ? `<button type="button" class="wr-attach-link wr-attach-preview-btn" title="Preview"
                onclick="TVC_Attachments.preview('${escAttr(id)}')">📎 ${name}</button>`
            : `<span class="wr-attach-link wr-attach-name">📎 ${name}</span>`;
        const removeBtn = canRemove && removeOnclick
            ? `<button type="button" class="wr-attach-remove" title="Remove" onclick="${removeOnclick}">×</button>`
            : '';
        return `<li class="wr-attach-item">
            ${previewBtn}
            <span class="wr-attach-size">${sizeKb}KB</span>
            <button type="button" class="wr-attach-dl-btn" title="Download"
                onclick="TVC_Attachments.download('${escAttr(id)}')">↓</button>
            ${removeBtn}
        </li>`;
    }

    function renderListHtml(attachments, options = {}) {
        const list = attachments || [];
        if (!list.length) return '';
        const items = list.map(a => renderListItemHtml(a, options)).join('');
        return `<div class="wr-attach-list-wrap"><ul class="wr-attach-list">${items}</ul></div>`;
    }

    return {
        register,
        resolve,
        isPreviewable,
        preview,
        closePreview,
        download,
        downloadCurrent,
        renderListItemHtml,
        renderListHtml,
    };
})();
