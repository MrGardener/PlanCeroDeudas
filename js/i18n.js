/*
 * Language layer. The app is written in English (US wording); other languages are dictionaries
 * keyed by that text (js/i18n/es.js). Everything on screen is translated as it appears: text,
 * placeholder / title / aria-label, toasts, dialogs and chart labels.
 *
 *   static text   'Monthly net income'            → 'Ingreso neto mensual'
 *   with values   '{0} left for {1} day{2}.'      → 'Te quedan {0} para {1} día{2|s|}.'
 *
 * In a translation, {n} is the value as shown; {n|a|b} prints a when the value is not empty and
 * b when it is (plural endings: English "s" → Spanish "es" / "s"); {n|a} is {n|a|}. Values that
 * are themselves in a dictionary (a month, a category…) are translated too.
 *
 * Saved data stays in Spanish (category names, types: 'Alimentación', 'Gasto'), and some older
 * text in the code is still Spanish: js/i18n/en.js translates those to English, and the
 * edition's Spanish wording (js/i18n/us.js) applies to them first.
 * An edition can reword English text for its country (js/i18n/ec.js: I18n.override).
 * Elements marked data-i18n-skip (and their children) are left alone: the user's own words.
 */
(function (root) {
    'use strict';
    const ATTRS = ['placeholder', 'title', 'aria-label', 'data-label'];
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const SOURCE = 'en';     // the language of the text in the code
    const dicts = {};        // lang → { exact: Map, patterns: [{ re, out, prefix }] , byPrefix: Map }
    const overrides = {};    // country → lang → compiled dictionary
    let lang = SOURCE;
    let known = null;        // English texts with a translation (pass-through, so their values translate)

    function compile(entries) {
        const d = { exact: new Map(), byPrefix: new Map(), lead: [] };
        Object.keys(entries).forEach(k => {
            const key = norm(k), out = entries[k];
            if (!/\{\d+\}/.test(key)) { d.exact.set(key, out); return; }
            const parts = key.split(/\{(\d+)\}/);
            const order = [];
            // A value that only picks an ending ({n|s|}) is a short ending, never a phrase.
            const endings = new Set();
            String(out).replace(/\{(\d+)\|([^}]*)\}/g, (_, n, alt) => { if (alt.split('|').every(x => x.length <= 4)) endings.add(n); return ''; });
            let src = '^';
            // A value never ends right before a decimal point: "$3,191.65." must not split at "191".
            parts.forEach((p, i) => {
                if (i % 2) { src += endings.has(p) ? '(\\S{0,4}?)' : '([\\s\\S]*?)'; order.push(Number(p)); return; }
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
            if (alt !== undefined) { const [a, b = ''] = alt.split('|'); return v ? a : b; }
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
    // Look a text up in one dictionary (exact, patterns, then pieces); undefined when unknown.
    function lookup(d, key) {
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
            const m = key.match(/^([:·,;–—.-]\s*)(.+)$/);
            if (m) { const inner = t(m[2]); if (inner !== m[2]) hit = m[1] + inner; }
        }
        // Lists joined with " · " or " + " ("Sueldo neto + otros ingresos ($1,900)"): piece by piece.
        for (const sep of [' · ', ' + ']) {
            if (hit !== undefined || !key.includes(sep)) continue;
            const parts = key.split(sep), tr = parts.map(p => t(p));
            if (tr.some((p, i) => p !== parts[i])) hit = tr.join(sep);
        }
        return hit;
    }

    // Edition wording for this language first, then the language's dictionary. Text that is
    // still Spanish (saved data, older code) goes through the edition's Spanish wording and,
    // in English, js/i18n/en.js.
    function t(text) {
        if (text == null) return text;
        const s = String(text);
        const key = norm(s);
        if (!key || !/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(key)) return s;
        let cur;
        const o = overrides[countryCode] && overrides[countryCode][lang];
        if (o) cur = lookup(o, key);
        if (cur === undefined) cur = lookup(lang === SOURCE ? knownDict() : dicts[lang] || knownDict(), key);
        if (cur === undefined) {
            let sp = key, changed = false;
            if (country && !inCountry) {
                inCountry = true;
                try { const c = lookup(country, key); if (c !== undefined) { sp = norm(c); changed = true; } } finally { inCountry = false; }
            }
            if (lang === LEGACY && dicts[LEGACY] && !inCountry) {
                const hit = lookup(dicts[LEGACY], sp);
                if (hit !== undefined) { sp = hit; changed = true; }
            }
            if (changed) cur = sp;
        }
        if (cur === undefined || cur === key) return s;
        // Keep the spaces around the original text.
        const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
        return lead + cur + trail;
    }
    // Spanish → English for text that is still Spanish (js/i18n/en.js).
    const LEGACY = 'en';
    function knownDict() {
        if (!known) {
            const src = {};
            Object.keys(dicts).forEach(l => { if (l !== LEGACY) Object.keys(dicts[l].src).forEach(k => { src[k] = k; }); });
            Object.values(overrides).forEach(byLang => Object.values(byLang).forEach(d => Object.keys(d.src).forEach(k => { src[k] = k; })));
            known = compile(src);
        }
        return known;
    }
    let country = null, countryCode = null, inCountry = false;
    const countries = {};

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
        if (!rootEl) return;
        if (rootEl.nodeType === 3) { if (!skip(rootEl.parentElement)) translateText(rootEl); return; }
        if (rootEl.nodeType !== 1 || skip(rootEl)) return;
        translateAttrs(rootEl);
        const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
            acceptNode: (n) => (n.nodeType === 1 ? (n.matches('[data-i18n-skip], script, style, textarea') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) : NodeFilter.FILTER_ACCEPT)
        });
        let n;
        while ((n = w.nextNode())) { if (n.nodeType === 3) translateText(n); else translateAttrs(n); }
    }

    // Back to the source text: put the original text back where it was replaced.
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
            if (busy) return;
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

    // The edition: its overrides, and its Spanish wording for text that is still Spanish.
    function setCountry(code) {
        countryCode = code || null;
        country = countries[code] || null;
        if (typeof document === 'undefined' || !document.body) return;
        busy = true;
        try { restore(document.body); apply(document.body); } finally { busy = false; }
        observe();
    }

    function setLang(l) {
        const next = l === SOURCE || dicts[l] ? l : SOURCE;
        // Dates and numbers follow the language (also on the first call, when it doesn't change).
        if (root.Fmt && Fmt.setLang) Fmt.setLang(next);
        document.documentElement.lang = next;
        if (next === lang) return;
        lang = next;
        busy = true;
        try { restore(document.body); apply(document.body); } finally { busy = false; }
        observe();
    }

    const merge = (prev, entries) => { const src = Object.assign({}, prev ? prev.src : {}, entries); const d = compile(src); d.src = src; return d; };

    root.I18n = {
        add(l, entries) { dicts[l] = merge(dicts[l], entries); known = null; },
        keys: (l) => Object.keys((dicts[l] && dicts[l].src) || {}),
        country(code, entries) { countries[code] = merge(countries[code], entries); },
        countryKeys: (code) => Object.keys((countries[code] && countries[code].src) || {}),
        override(code, l, entries) { overrides[code] = overrides[code] || {}; overrides[code][l] = merge(overrides[code][l], entries); known = null; },
        overrideKeys: (code, l) => Object.keys((overrides[code] && overrides[code][l] && overrides[code][l].src) || {}),
        setCountry,
        t, apply, setLang, get lang() { return lang; }, get countryCode() { return countryCode; }, has: (l) => l === SOURCE || !!dicts[l]
    };
})(this);
