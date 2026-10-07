/* Fmt — formatting and escaping helpers shared by every view. */
(function (root) {
    'use strict';

    const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    // Display currency. Ecuador uses the US dollar, but amounts can be shown in another
    // currency's symbol and number style (display only: nothing is converted).
    const CURRENCIES = [
        { code: 'USD', label: 'US dollar (USD)', symbol: '$', locale: 'en-US', decimals: 2 },
        { code: 'EUR', label: 'Euro (EUR)', symbol: '€', locale: 'es-ES', decimals: 2, after: true },
        { code: 'COP', label: 'Colombian peso (COP)', symbol: 'COP $', locale: 'es-CO', decimals: 0 },
        { code: 'PEN', label: 'Peruvian sol (PEN)', symbol: 'S/', locale: 'es-PE', decimals: 2 },
        { code: 'MXN', label: 'Mexican peso (MXN)', symbol: 'MX$', locale: 'es-MX', decimals: 2 },
        { code: 'CLP', label: 'Chilean peso (CLP)', symbol: 'CLP $', locale: 'es-CL', decimals: 0 },
        { code: 'ARS', label: 'Argentine peso (ARS)', symbol: 'ARS $', locale: 'es-AR', decimals: 2 },
        { code: 'BOB', label: 'Boliviano (BOB)', symbol: 'Bs', locale: 'es-BO', decimals: 2 },
        { code: 'GTQ', label: 'Quetzal (GTQ)', symbol: 'Q', locale: 'es-GT', decimals: 2 },
        { code: 'DOP', label: 'Dominican peso (DOP)', symbol: 'RD$', locale: 'es-DO', decimals: 2 },
        { code: 'BRL', label: 'Brazilian real (BRL)', symbol: 'R$', locale: 'pt-BR', decimals: 2 },
        { code: 'GBP', label: 'Pound sterling (GBP)', symbol: '£', locale: 'en-GB', decimals: 2 },
        { code: 'CAD', label: 'Canadian dollar (CAD)', symbol: 'CA$', locale: 'en-CA', decimals: 2 },
        { code: 'INR', label: 'Indian rupee (INR)', symbol: '₹', locale: 'en-IN', decimals: 2 }
    ];
    let cur = CURRENCIES[0];
    const setCurrency = (code) => { cur = CURRENCIES.find(c => c.code === code) || CURRENCIES[0]; return cur; };
    const currency = () => cur;

    // "Hide amounts" (a device setting): every amount on screen shows as •••; files and data are untouched.
    let hidden = false;
    const setHidden = (on) => { hidden = !!on; };
    function fmt(n, decimals) {
        if (hidden) return cur.after ? `••• ${cur.symbol}` : `${cur.symbol}•••`;
        const v = Number(n) || 0;
        const d = Math.min(decimals, cur.decimals);
        const num = Math.abs(v).toLocaleString(cur.locale, { minimumFractionDigits: d, maximumFractionDigits: d });
        const s = cur.after ? `${num} ${cur.symbol}` : `${cur.symbol}${cur.symbol.length > 1 && !cur.symbol.endsWith('$') ? ' ' : ''}${num}`;
        // A true minus sign (U+2212), the same one the views put before amounts.
        return v < 0 && Math.abs(v) >= 0.5 * Math.pow(10, -d) ? '\u2212' + s : s;
    }
    const money = (n) => fmt(n, 2);
    const money0 = (n) => fmt(n, 0);
    const pct = (n, digits = 1) => `${(Number(n) || 0).toFixed(digits)}%`;

    // Every piece of user-entered text goes through this before reaching innerHTML.
    const esc = (s) => String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const parseNum = (v, fallback = 0) => {
        if (v === '' || v === null || v === undefined) return fallback;
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : fallback;
    };

    const monthsAsYears = (m) => {
        const y = Math.floor(m / 12), r = m % 12;
        const Y = lang === 'en' ? 'y' : 'a';
        if (y === 0) return `${r}m`;
        return r === 0 ? `${y}${Y}` : `${y}${Y} ${r}m`;
    };

    const monthYear = (date) => `${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`;

    // Language of month and weekday names (the arrays are updated in place, so code holding
    // them sees the change). Weekdays start on Monday.
    const DOW_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    const NAMES = {
        es: { months: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'], short: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'], dow: ['L', 'M', 'M', 'J', 'V', 'S', 'D'] },
        en: { months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], short: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], dow: ['M', 'T', 'W', 'T', 'F', 'S', 'S'] }
    };
    let lang = 'es';
    function setLang(l) {
        lang = NAMES[l] ? l : 'es';
        MONTH_NAMES.splice(0, 12, ...NAMES[lang].months);
        MONTH_SHORT.splice(0, 12, ...NAMES[lang].short);
        DOW_SHORT.splice(0, 7, ...NAMES[lang].dow);
        WEEKDAYS.splice(0, 7, ...WEEKDAYS_ALL[lang]);
    }
    const monthLower = (i) => (lang === 'en' ? MONTH_NAMES[i] : MONTH_NAMES[i].toLowerCase());
    const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const WEEKDAYS_ALL = { es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
    // "30 de septiembre" / "September 30"
    const dayMonth = (date) => (lang === 'en' ? `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}` : `${date.getDate()} de ${MONTH_NAMES[date.getMonth()].toLowerCase()}`);

    const Fmt = { setHidden, get hidden() { return hidden; }, MONTH_NAMES, MONTH_SHORT, DOW_SHORT, WEEKDAYS, monthLower, CURRENCIES, setCurrency, currency, money, money0, pct, esc, parseNum, monthsAsYears, monthYear, setLang, dayMonth, get lang() { return lang; } };
    if (typeof module !== 'undefined' && module.exports) module.exports = Fmt;
    else root.Fmt = Fmt;
})(this);
