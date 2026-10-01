/*
 * Language layer. The app is written in Spanish; other languages are dictionaries
 * (js/i18n/en.js…) keyed by the Spanish text. Everything on screen is translated as it appears:
 * text, placeholder / title / aria-label, toasts, dialogs and chart labels.
 *
 *   static text   'Ingreso neto mensual'            → 'Monthly net income'
 *   with values   'Te quedan {0} para {1} día{2}.'  → '{0} left for {1} day{2|s}.'
 *
 * In a translation, {n} is the value as shown; {n|word} prints "word" only when the value is
 * not empty (Spanish plural endings like "es" / "s" → English "s"). Values that are themselves
 * in the dictionary (a month, a category…) are translated too. Elements marked
 * data-i18n-skip (and their children) are left alone: that's for the user's own words.
 */
(function (root) {
    'use strict';
    const ATTRS = ['placeholder', 'title', 'aria-label'];
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const dicts = {};        // lang → { exact: Map, patterns: [{ re, out, prefix }] , byPrefix: Map }
    let lang = 'es';

    function compile(entries) {
        const d = { exact: new Map(), byPrefix: new Map(), lead: [] };
        Object.keys(entries).forEach(k => {
            const key = norm(k), out = entries[k];
            if (!/\{\d+\}/.test(key)) { d.exact.set(key, out); return; }
            const parts = key.split(/\{(\d+)\}/);
            const order = [];
            let src = '^';
            // A value never ends right before a decimal point: "$3,191.65." must not split at "191".
            parts.forEach((p, i) => {
                if (i % 2) { src += '([\\s\\S]*?)'; order.push(Number(p)); return; }
                let lit = esc(p);
                if (i > 0 && /^[.,]/.test(p)) lit = lit.replace(/^(\\?[.,])/, '$1(?!\\d)');
                src += lit;
            });
            // How specific the pattern is: its own letters. Very generic ones ("{0} de {1}") may
            // only wrap numbers/amounts, never words.
            const letters = parts.filter((_, i) => i % 2 === 0).join('').replace(/[^A-Za-zÁÉÍÓÚáéíóúñÑ]/g, '').length;
            // Pass-through patterns (same text in both languages, e.g. "{0} · {1}") just let their
            // values be translated; they're never "weak".
            const pat = { re: new RegExp(src + '$'), out, order, letters, weak: out !== key && letters <= 2 };
            const prefix = parts[0].slice(0, 4);
            if (prefix.length < 4) d.lead.push(pat);
            else { if (!d.byPrefix.has(prefix)) d.byPrefix.set(prefix, []); d.byPrefix.get(prefix).push(pat); }
        });
        const bySpecific = (a, b) => b.letters - a.letters;
        d.lead.sort(bySpecific);
        d.byPrefix.forEach(list => list.sort(bySpecific));
        return d;
    }

    function fill(out, vals) {
        return out.replace(/\{(\d+)(?:\|([^}]*))?\}/g, (_, n, alt) => {
            const v = vals[Number(n)];
            if (v === undefined) return '';
            if (alt !== undefined) return v ? alt : '';
            return depth < 3 ? translate(v, depth + 1) : v;
        });
    }
    let depth = 0;

    // Translate one string (exact or pattern); returns it unchanged when unknown. Values caught
    // by a pattern are translated too (a few levels deep).
    function translate(text, level) {
        const prev = depth;
        depth = level;
        try { return t(text); } finally { depth = prev; }
    }
    function t(text) {
        if (lang === 'es' || text == null) return text;
        const d = dicts[lang];
        if (!d) return text;
        const s = String(text);
        const key = norm(s);
        if (!key || !/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(key)) return s;
        let hit = d.exact.get(key);
        if (hit === undefined) {
            const cands = (d.byPrefix.get(key.slice(0, 4)) || []).concat(d.lead);
            cands.sort((a, b) => b.letters - a.letters);
            for (const p of cands) {
                const m = key.match(p.re);
                if (!m) continue;
                const vals = [];
                p.order.forEach((n, i) => { vals[n] = m[i + 1]; });
                if (p.weak && vals.some(v => /[A-Za-zÁÉÍÓÚáéíóúñÑ]{2}/.test(v || ''))) continue;
                hit = fill(p.out, vals);
                break;
            }
        }
        // Leading punctuation (": tu sueldo…", "· …") or a list joined with " · ": translate the pieces.
        if (hit === undefined) {
            const m = key.match(/^([:·,;–—-]\s*)(.+)$/);
            if (m) { const inner = t(m[2]); if (inner !== m[2]) hit = m[1] + inner; }
        }
        if (hit === undefined && key.includes(' · ')) {
            const parts = key.split(' · '), tr = parts.map(p => t(p));
            if (tr.some((p, i) => p !== parts[i])) hit = tr.join(' · ');
        }
        if (hit === undefined) return s;
        // Keep the spaces around the original text.
        const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
        return lead + hit + trail;
    }

    const skip = (el) => el && el.closest && el.closest('[data-i18n-skip], script, style, textarea');

    function translateText(node) {
        const src = node.__i18nSrc !== undefined && node.nodeValue === node.__i18nOut ? node.__i18nSrc : node.nodeValue;
        if (!src || !src.trim()) return;
        const out = t(src);
        node.__i18nSrc = src;
        node.__i18nOut = out;
        if (out !== node.nodeValue) node.nodeValue = out;
    }
    function translateAttrs(el) {
        ATTRS.forEach(a => {
            if (!el.hasAttribute(a)) return;
            const cur = el.getAttribute(a);
            const k = 'i18n' + a.replace(/-./g, m => m[1].toUpperCase());
            const src = el.dataset[k + 'Out'] === cur && el.dataset[k] !== undefined ? el.dataset[k] : cur;
            const out = t(src);
            el.dataset[k] = src; el.dataset[k + 'Out'] = out;
            if (out !== cur) el.setAttribute(a, out);
        });
    }

    function apply(rootEl) {
        if (lang === 'es' || !rootEl) return;
        if (rootEl.nodeType === 3) { if (!skip(rootEl.parentElement)) translateText(rootEl); return; }
        if (rootEl.nodeType !== 1 || skip(rootEl)) return;
        translateAttrs(rootEl);
        const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
            acceptNode: (n) => (n.nodeType === 1 ? (n.matches('[data-i18n-skip], script, style, textarea') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) : NodeFilter.FILTER_ACCEPT)
        });
        let n;
        while ((n = w.nextNode())) { if (n.nodeType === 3) translateText(n); else translateAttrs(n); }
    }

    // Back to Spanish: put the original text back where it was replaced.
    function restore(rootEl) {
        const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        let n;
        while ((n = w.nextNode())) {
            if (n.nodeType === 3) { if (n.__i18nSrc !== undefined && n.nodeValue === n.__i18nOut) n.nodeValue = n.__i18nSrc; delete n.__i18nSrc; delete n.__i18nOut; continue; }
            ATTRS.forEach(a => {
                const k = 'i18n' + a.replace(/-./g, m => m[1].toUpperCase());
                if (n.dataset && n.dataset[k] !== undefined) { if (n.getAttribute(a) === n.dataset[k + 'Out']) n.setAttribute(a, n.dataset[k]); delete n.dataset[k]; delete n.dataset[k + 'Out']; }
            });
        }
    }

    let observer = null, busy = false;
    function observe() {
        if (observer || typeof MutationObserver === 'undefined') return;
        observer = new MutationObserver((muts) => {
            if (busy || lang === 'es') return;
            busy = true;
            try {
                muts.forEach(m => {
                    if (m.type === 'childList') m.addedNodes.forEach(apply);
                    else if (m.type === 'characterData') { if (m.target.nodeValue !== m.target.__i18nOut && !skip(m.target.parentElement)) translateText(m.target); }
                    else if (m.type === 'attributes' && !skip(m.target)) translateAttrs(m.target);
                });
            } finally { busy = false; }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }

    function setLang(l) {
        const next = dicts[l] || l === 'es' ? l : 'es';
        if (next === lang) return;
        const prev = lang;
        lang = next;
        document.documentElement.lang = lang;
        if (root.Fmt && Fmt.setLang) Fmt.setLang(lang);
        busy = true;
        try { if (prev !== 'es') restore(document.body); apply(document.body); } finally { busy = false; }
        observe();
    }

    root.I18n = {
        add(l, entries) { const src = Object.assign({}, dicts[l] ? dicts[l].src : {}, entries); dicts[l] = compile(src); dicts[l].src = src; },
        keys: (l) => Object.keys((dicts[l] && dicts[l].src) || {}),
        t, apply, setLang, get lang() { return lang; }, has: (l) => l === 'es' || !!dicts[l]
    };
})(this);
