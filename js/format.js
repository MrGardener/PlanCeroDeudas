/* Fmt — formatting and escaping helpers shared by every view. */
(function (root) {
    'use strict';

    const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    // Display currency. Ecuador uses the US dollar, but amounts can be shown in another
    // currency's symbol and number style (display only: nothing is converted).
    const CURRENCIES = [
        { code: 'USD', label: 'Dólar estadounidense (USD) — Ecuador', symbol: '$', locale: 'en-US', decimals: 2 },
        { code: 'EUR', label: 'Euro (EUR)', symbol: '€', locale: 'es-ES', decimals: 2, after: true },
        { code: 'COP', label: 'Peso colombiano (COP)', symbol: 'COP $', locale: 'es-CO', decimals: 0 },
        { code: 'PEN', label: 'Sol peruano (PEN)', symbol: 'S/', locale: 'es-PE', decimals: 2 },
        { code: 'MXN', label: 'Peso mexicano (MXN)', symbol: 'MX$', locale: 'es-MX', decimals: 2 },
        { code: 'CLP', label: 'Peso chileno (CLP)', symbol: 'CLP $', locale: 'es-CL', decimals: 0 },
        { code: 'ARS', label: 'Peso argentino (ARS)', symbol: 'ARS $', locale: 'es-AR', decimals: 2 },
        { code: 'BOB', label: 'Boliviano (BOB)', symbol: 'Bs', locale: 'es-BO', decimals: 2 },
        { code: 'GTQ', label: 'Quetzal (GTQ)', symbol: 'Q', locale: 'es-GT', decimals: 2 },
        { code: 'DOP', label: 'Peso dominicano (DOP)', symbol: 'RD$', locale: 'es-DO', decimals: 2 },
        { code: 'BRL', label: 'Real brasileño (BRL)', symbol: 'R$', locale: 'pt-BR', decimals: 2 },
        { code: 'GBP', label: 'Libra esterlina (GBP)', symbol: '£', locale: 'en-GB', decimals: 2 },
        { code: 'CAD', label: 'Dólar canadiense (CAD)', symbol: 'CA$', locale: 'en-CA', decimals: 2 },
        { code: 'INR', label: 'Rupia india (INR)', symbol: '₹', locale: 'en-IN', decimals: 2 }
    ];
    let cur = CURRENCIES[0];
    const setCurrency = (code) => { cur = CURRENCIES.find(c => c.code === code) || CURRENCIES[0]; return cur; };
    const currency = () => cur;

    function fmt(n, decimals) {
        const v = Number(n) || 0;
        const d = Math.min(decimals, cur.decimals);
        const num = Math.abs(v).toLocaleString(cur.locale, { minimumFractionDigits: d, maximumFractionDigits: d });
        const s = cur.after ? `${num} ${cur.symbol}` : `${cur.symbol}${cur.symbol.length > 1 && !cur.symbol.endsWith('$') ? ' ' : ''}${num}`;
        return v < 0 && Math.abs(v) >= 0.5 * Math.pow(10, -d) ? '-' + s : s;
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
        if (y === 0) return `${r}m`;
        return r === 0 ? `${y}a` : `${y}a ${r}m`;
    };

    const monthYear = (date) => `${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`;

    const Fmt = { MONTH_NAMES, MONTH_SHORT, CURRENCIES, setCurrency, currency, money, money0, pct, esc, parseNum, monthsAsYears, monthYear };
    if (typeof module !== 'undefined' && module.exports) module.exports = Fmt;
    else root.Fmt = Fmt;
})(this);
