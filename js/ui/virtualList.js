/* Virtual List — renders visible rows only */
const TVC_VirtualList = (function () {
    const ROW_H = 36;

    function mount(container, options) {
        const { rowHeight = ROW_H, renderRow, getCount, overflowX, overflowY } = options;
        container.innerHTML = '';
        if (overflowX != null || overflowY != null) {
            container.style.overflowX = overflowX ?? 'auto';
            container.style.overflowY = overflowY ?? 'auto';
        } else {
            container.style.overflow = 'auto';
        }
        container.style.position = 'relative';

        const inner = document.createElement('div');
        inner.className = 'vl-inner';
        inner.style.position = 'relative';
        inner.style.width = '100%';
        container.appendChild(inner);

        let raf = null;

        function paint() {
            const count = getCount();
            const scrollTop = container.scrollTop;
            const viewH = container.clientHeight || 400;
            inner.style.height = (count * rowHeight) + 'px';

            const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
            const end = Math.min(count, Math.ceil((scrollTop + viewH) / rowHeight) + 4);

            inner.innerHTML = '';
            for (let i = start; i < end; i++) {
                const row = document.createElement('div');
                row.className = 'vl-row';
                row.style.cssText = `position:absolute;top:${i * rowHeight}px;left:0;right:0;height:${rowHeight}px;`;
                row.innerHTML = renderRow(i);
                inner.appendChild(row);
            }
        }

        function schedule() {
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(paint);
        }

        container.onscroll = schedule;
        schedule();
        return {
            refresh: schedule,
            destroy: () => { container.onscroll = null; container.innerHTML = ''; },
        };
    }

    return { mount, ROW_H };
})();
