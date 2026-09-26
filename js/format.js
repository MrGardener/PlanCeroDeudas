/* Fmt — formatting and escaping helpers shared by every view. */
(function (root) {
    'use strict';

    const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    const money = (n) => {
        const v = Number(n) || 0;
        const s = '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return v < 0 ? '-' + s : s;
    };
    const money0 = (n) => {
        const v = Number(n) || 0;
        const s = '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
        return v < 0 ? '-' + s : s;
    };
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

    const Fmt = { MONTH_NAMES, MONTH_SHORT, money, money0, pct, esc, parseNum, monthsAsYears, monthYear };
    if (typeof module !== 'undefined' && module.exports) module.exports = Fmt;
    else root.Fmt = Fmt;
})(this);
