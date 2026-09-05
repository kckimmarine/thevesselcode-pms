/* THE VESSEL CODE — Header feedback modal (multi photo + comment blocks) */
const TVC_Feedback = (function () {
    const MODAL_ID = 'modal-feedback';
    const LIST_ID = 'feedback-item-list';
    const TOAST_ID = 'tvcFeedbackToast';
    let itemSeq = 0;
    const previewUrls = new Set();
    let modalPasteBound = false;

    function el(id) { return document.getElementById(id); }

    function revokePreviews() {
        previewUrls.forEach(url => {
            try { URL.revokeObjectURL(url); } catch (_) { /* noop */ }
        });
        previewUrls.clear();
    }

    function showToast(message) {
        let toast = el(TOAST_ID);
        if (!toast) {
            toast = document.createElement('div');
            toast.id = TOAST_ID;
            toast.className = 'tvc-feedback-toast hidden';
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.remove('hidden');
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => toast.classList.add('hidden'), 3200);
    }

    function imageFileFromClipboard(event) {
        const items = event.clipboardData?.items;
        if (!items) return null;
        for (const item of items) {
            if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
                return item.getAsFile();
            }
        }
        return null;
    }

    function setCardImage(card, file) {
        if (!card || !file || !String(file.type || '').startsWith('image/')) return false;
        const preview = card.querySelector('.feedback-photo-preview');
        const img = card.querySelector('.feedback-photo-img');
        const empty = card.querySelector('.feedback-photo-empty');
        if (!preview || !img) return false;

        if (card._feedbackPreviewUrl) {
            previewUrls.delete(card._feedbackPreviewUrl);
            try { URL.revokeObjectURL(card._feedbackPreviewUrl); } catch (_) { /* noop */ }
        }

        const url = URL.createObjectURL(file);
        previewUrls.add(url);
        card._feedbackPreviewUrl = url;
        card._feedbackBlob = file;
        img.src = url;
        img.alt = file.name || 'Attached screenshot';
        preview.classList.remove('hidden');
        if (empty) empty.classList.add('hidden');

        const input = card.querySelector('.feedback-photo-input');
        if (input) {
            try {
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
            } catch (_) {
                input.value = '';
            }
        }
        return true;
    }

    function bindCard(card) {
        const input = card.querySelector('.feedback-photo-input');
        const removeBtn = card.querySelector('.feedback-remove-btn');

        input?.addEventListener('change', () => {
            const file = input.files?.[0];
            if (file) setCardImage(card, file);
        });

        card.addEventListener('paste', (event) => {
            const file = imageFileFromClipboard(event);
            if (!file) return;
            event.preventDefault();
            setCardImage(card, file);
        });

        removeBtn?.addEventListener('click', () => {
            const list = el(LIST_ID);
            if (!list || list.querySelectorAll('.feedback-item-card').length <= 1) return;
            if (card._feedbackPreviewUrl) {
                previewUrls.delete(card._feedbackPreviewUrl);
                try { URL.revokeObjectURL(card._feedbackPreviewUrl); } catch (_) { /* noop */ }
            }
            card.remove();
            updateRemoveButtons();
        });
    }

    function buildItemCard() {
        itemSeq += 1;
        const card = document.createElement('div');
        card.className = 'feedback-item-card';
        card.dataset.feedbackItem = String(itemSeq);
        card.innerHTML = `
            <div class="feedback-photo-wrap">
                <label class="feedback-photo-label">
                    <input type="file" class="feedback-photo-input" accept="image/*">
                    <span class="feedback-photo-btn">📷 Attach photo</span>
                </label>
                <p class="feedback-photo-empty muted">Paste an image with Ctrl+V while this card is focused.</p>
                <div class="feedback-photo-preview hidden">
                    <img class="feedback-photo-img" alt="">
                </div>
            </div>
            <label class="feedback-comment-label">
                <span class="feedback-comment-caption">Comment</span>
                <textarea class="feedback-comment" rows="3" placeholder="어떤 점이 어색하거나 개선이 필요한가요?"></textarea>
            </label>
            <button type="button" class="feedback-remove-btn btn btn-sm hidden">Remove issue</button>`;
        bindCard(card);
        return card;
    }

    function updateRemoveButtons() {
        const list = el(LIST_ID);
        if (!list) return;
        const cards = list.querySelectorAll('.feedback-item-card');
        cards.forEach((card, idx) => {
            const btn = card.querySelector('.feedback-remove-btn');
            if (!btn) return;
            btn.classList.toggle('hidden', cards.length <= 1);
            btn.setAttribute('aria-hidden', cards.length <= 1 ? 'true' : 'false');
            card.dataset.feedbackIndex = String(idx + 1);
        });
    }

    function resetList() {
        const list = el(LIST_ID);
        if (!list) return;
        revokePreviews();
        list.innerHTML = '';
        itemSeq = 0;
    }

    function bindModalPaste() {
        if (modalPasteBound) return;
        const modal = el(MODAL_ID);
        if (!modal) return;
        modal.addEventListener('paste', (event) => {
            const file = imageFileFromClipboard(event);
            if (!file) return;
            const list = el(LIST_ID);
            const cards = list?.querySelectorAll('.feedback-item-card') || [];
            const activeCard = document.activeElement?.closest?.('.feedback-item-card');
            const target = activeCard || cards[cards.length - 1];
            if (!target) return;
            event.preventDefault();
            setCardImage(target, file);
        });
        modalPasteBound = true;
    }

    function addItem() {
        const list = el(LIST_ID);
        if (!list) return null;
        const card = buildItemCard();
        list.appendChild(card);
        updateRemoveButtons();
        card.querySelector('.feedback-comment')?.focus();
        return card;
    }

    function open() {
        resetList();
        addItem();
        bindModalPaste();
        window.TVC_App?.showModal?.(MODAL_ID);
        el(LIST_ID)?.querySelector('.feedback-comment')?.focus();
    }

    function close() {
        window.TVC_App?.closeModal?.(MODAL_ID);
        resetList();
    }

    async function submit() {
        const list = el(LIST_ID);
        if (!list) return;
        const cards = [...list.querySelectorAll('.feedback-item-card')];
        const payload = cards.map((card, index) => {
            const comment = card.querySelector('.feedback-comment')?.value?.trim() || '';
            const input = card.querySelector('.feedback-photo-input');
            const file = input?.files?.[0] || card._feedbackBlob || null;
            return {
                index: index + 1,
                comment,
                fileName: file?.name || null,
                fileType: file?.type || null,
                fileSize: file?.size || 0,
                file,
            };
        });

        const hasContent = payload.some(item => item.comment || item.file);
        if (!hasContent) {
            showToast('코멘트 또는 사진을 하나 이상 추가해 주세요.');
            return;
        }

        console.info('[TVC-Feedback] submit payload', payload.map(item => ({
            index: item.index,
            comment: item.comment,
            fileName: item.fileName,
            fileType: item.fileType,
            fileSize: item.fileSize,
        })));

        close();
        showToast('피드백이 성공적으로 접수되었습니다. 감사합니다!');
    }

    return { open, close, addItem, submit };
})();
