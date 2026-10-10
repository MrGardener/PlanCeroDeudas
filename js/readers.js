/*
 * Reading the text of a PDF (pdf.js) or a photo (Tesseract), for pay stubs and receipts. The file
 * never leaves the device: the reader comes to it, only when a file is read.
 * - The web file gets them from jsDelivr at exact versions (published npm versions never change);
 *   the build adds each main file's hash (window.APP_READERS), so the browser refuses a file that
 *   isn't exactly that one. Tesseract's worker runs apart from the page (no access to the plan).
 * - The phone app carries them (vendor/), so nothing is downloaded at all.
 */
(function (root) {
    'use strict';
    const J = 'https://cdn.jsdelivr.net/npm/';
    // Development (index.html): the same versions, without hashes.
    const DEFAULTS = {
        pdf: { src: J + 'pdfjs-dist@3.11.174/build/pdf.min.js', worker: J + 'pdfjs-dist@3.11.174/build/pdf.worker.min.js' },
        ocr: { src: J + 'tesseract.js@5.1.1/dist/tesseract.min.js', workerPath: J + 'tesseract.js@5.1.1/dist/worker.min.js', corePath: J + 'tesseract.js-core@5.1.1' }
    };
    const cfg = (k) => Object.assign({}, DEFAULTS[k], (root.APP_READERS || {})[k] || {});

    function load(src, integrity, test) {
        if (test()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const sc = document.createElement('script');
            if (integrity) { sc.integrity = integrity; sc.crossOrigin = 'anonymous'; }
            sc.src = src;
            sc.onload = () => (test() ? resolve() : reject(new Error('no reader')));
            sc.onerror = () => reject(new Error('offline'));
            document.head.appendChild(sc);
        });
    }

    // A PDF's text, line by line (items on the same baseline, left to right), first pages only.
    async function pdfText(file, maxPages = 4) {
        const c = cfg('pdf');
        await load(c.src, c.integrity, () => !!root.pdfjsLib);
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            // A worker from another site can't start from a local file: fetched (checked against
            // its hash when there is one) and started from a blob.
            const r = await fetch(c.worker, c.workerIntegrity ? { integrity: c.workerIntegrity } : {});
            pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([await r.text()], { type: 'text/javascript' }));
        }
        const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
        const lines = [];
        for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
            const content = await (await doc.getPage(n)).getTextContent();
            const rows = {};
            content.items.forEach(it => { const y = Math.round(it.transform[5] / 3); (rows[y] = rows[y] || []).push(it); });
            Object.keys(rows).map(Number).sort((a, b) => b - a).forEach(y => lines.push(rows[y].sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join('  ')));
        }
        return lines.join('\n');
    }

    // A photo's text (Spanish and English), reporting progress 0–1.
    async function photoText(file, onProgress, langs = ['spa', 'eng']) {
        const c = cfg('ocr');
        await load(c.src, c.integrity, () => !!root.Tesseract);
        const opts = { workerPath: c.workerPath, corePath: c.corePath, logger: m => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress || 0); } };
        if (c.langPath) opts.langPath = c.langPath;
        // The phone app's worker is a local file: it starts directly.
        if (c.local) opts.workerBlobURL = false;
        const worker = await Tesseract.createWorker(langs, 1, opts);
        try { return (await worker.recognize(file)).data.text; } finally { await worker.terminate(); }
    }

    root.Readers = { pdfText, photoText, DEFAULTS };
})(this);
