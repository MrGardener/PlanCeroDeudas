/* Patrimonio → Tu familia protegida y tu revisión anual: two checklists that keep the date each
 * item was done. The yearly review starts over every year (state.checklists.review['YYYY']). */
(function () {
    'use strict';
    const { esc } = Fmt;
    const st = () => Store.state.checklists || (Store.state.checklists = { estate: {}, review: {} });
    const lists = () => (Store.defaults.checklists ? Store.defaults.checklists() : { estate: [], review: [] });
    const year = () => String(new Date().getFullYear());

    // How far along each list is (also used by the Overview's next moves).
    function progress() {
        const s = st(), l = lists(), done = s.review[year()] || {};
        return { estate: l.estate.filter(i => s.estate[i.key]).length / Math.max(1, l.estate.length), will: !!s.estate.will,
            review: l.review.filter(i => done[i.key]).length / Math.max(1, l.review.length) };
    }

    function list(kind, items, done) {
        return items.map(i => `<label class="check-item ${done[i.key] ? 'done' : ''}"><input type="checkbox" data-change="check.toggle" data-kind="${kind}" data-key="${i.key}" ${done[i.key] ? 'checked' : ''}>
            <span class="min-w-0"><span class="block font-semibold">${esc(i.label)}</span><span class="block text-[11px] text-slate-500">${esc(i.why)}</span>${done[i.key] ? `<span class="block text-[11px] text-emerald-700"><i class="fa-solid fa-check"></i> <span>${esc(Fmt.monthYear(new Date(done[i.key] + 'T00:00:00')))}</span></span>` : ''}</span></label>`).join('');
    }

    function render() {
        if (!document.getElementById('nw-checklists')) return;
        const s = st(), l = lists(), p = progress();
        UI.html('check-estate', list('estate', l.estate, s.estate));
        UI.html('check-review', list('review', l.review, s.review[year()] || {}));
        UI.text('check-estate-pct', `${Math.round(p.estate * 100)}%`);
        UI.text('check-review-pct', `${Math.round(p.review * 100)}%`);
        UI.text('check-review-year', year());
    }

    UI.register({
        'check.toggle': (el) => {
            const s = st(), today = Engine.isoDate(new Date());
            const box = el.dataset.kind === 'estate' ? s.estate : (s.review[year()] || (s.review[year()] = {}));
            if (el.checked) box[el.dataset.key] = today; else delete box[el.dataset.key];
            App.changed({ structural: true, step: true });
        }
    });

    window.Checklists = { render, progress };
})();
