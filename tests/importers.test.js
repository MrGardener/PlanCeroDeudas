// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../js/importers.js');

test('CSV: delimiter, quotes and line breaks inside quotes', () => {
    const semi = 'Fecha;Concepto;Valor\n01/09/2026;"Supermaxi; Quito";-45,50\n02/09/2026;Sueldo;1.200,00\n';
    const p = I.parseCSV(semi);
    assert.equal(p.delimiter, ';');
    assert.deepEqual(p.rows[1], ['01/09/2026', 'Supermaxi; Quito', '-45,50']);
    const comma = 'date,description,amount\n2026-09-03,"Line one\nline two",12.00\n';
    const q = I.parseCSV(comma);
    assert.equal(q.delimiter, ',');
    assert.equal(q.rows[1][1], 'Line one\nline two');
    assert.equal(I.parseCSV('a\tb\tc\n1\t2\t3').delimiter, '\t');
});

test('amounts in any style', () => {
    assert.equal(I.parseAmount('1.234,56'), 1234.56);
    assert.equal(I.parseAmount('1,234.56'), 1234.56);
    assert.equal(I.parseAmount('-45,50'), -45.5);
    assert.equal(I.parseAmount('(45.00)'), -45);
    assert.equal(I.parseAmount('$ -12.30'), -12.3);
    assert.equal(I.parseAmount('12.50-'), -12.5);
    assert.equal(I.parseAmount('1.234.567'), 1234567);
    assert.equal(I.parseAmount('1,5'), 1.5);
    assert.equal(I.parseAmount(''), null);
    assert.equal(I.parseAmount('abc'), null);
});

test('dates: Ecuador day-first by default, ISO, month names', () => {
    assert.equal(I.parseDate('05/09/2026'), '2026-09-05');
    assert.equal(I.parseDate('09/25/2026'), '2026-09-25');          // 25 can't be a month
    assert.equal(I.parseDate('09/05/2026', 'mdy'), '2026-09-05');
    assert.equal(I.parseDate('2026-09-05T10:00'), '2026-09-05');
    assert.equal(I.parseDate('5-sep-26'), '2026-09-05');
    assert.equal(I.parseDate('31/02/2026'), null);
    assert.equal(I.parseDate('hola'), null);
});

test('column guess, rows and duplicates', () => {
    const m = I.guessMapping(['Fecha', 'Descripción', 'Débito', 'Crédito', 'Saldo']);
    assert.equal(m.mode, 'split');
    assert.equal(m.date, 0); assert.equal(m.description, 1); assert.equal(m.debit, 2); assert.equal(m.credit, 3);
    const rows = I.buildRows([
        ['01/09/2026', 'Supermaxi', '45,50', '', '900'],
        ['02/09/2026', 'Transferencia recibida', '', '200,00', '1100'],
        ['xx', 'Mala', '1', '', ''],
        ['03/09/2026', '', '', '', '']
    ], m);
    assert.deepEqual([rows[0].type, rows[0].amount, rows[0].date], ['Gasto', 45.5, '2026-09-01']);
    assert.deepEqual([rows[1].type, rows[1].amount], ['Ingreso', 200]);
    assert.equal(rows[2].error, 'Fecha no reconocida');
    assert.equal(rows[3].error, 'Sin monto');
    const single = I.guessMapping(['date', 'description', 'amount', 'category']);
    assert.equal(single.mode, 'single'); assert.equal(single.category, 3);
    const pos = I.buildRows([['2026-09-01', 'Coffee', '4.50', 'Food']], { ...single, expensesAre: 'positive' });
    assert.deepEqual([pos[0].type, pos[0].amount, pos[0].category], ['Gasto', 4.5, 'Food']);
    assert.ok(I.isDuplicate(rows[0], [{ type: 'Gasto', date: '2026-09-01', amount: 45.5, description: 'SUPERMAXI' }]));
    assert.ok(!I.isDuplicate(rows[0], [{ type: 'Gasto', date: '2026-09-02', amount: 45.5, description: 'Supermaxi' }]));
});

test('running balance column gives the account balance after the latest movement', () => {
    const m = I.guessMapping(['Fecha', 'Descripción', 'Débito', 'Crédito', 'Saldo']);
    assert.equal(m.balance, 4);
    const oldestFirst = I.buildRows([['01/09/2026', 'A', '10', '', '990'], ['02/09/2026', 'B', '', '5', '995'], ['02/09/2026', 'C', '20', '', '975']], m);
    assert.deepEqual(I.latestBalance(oldestFirst), { date: '2026-09-02', balance: 975 });
    const newestFirst = I.buildRows([['02/09/2026', 'C', '20', '', '975'], ['02/09/2026', 'B', '', '5', '995'], ['01/09/2026', 'A', '10', '', '990']], m);
    assert.deepEqual(I.latestBalance(newestFirst), { date: '2026-09-02', balance: 975 });
    assert.equal(I.latestBalance(I.buildRows([['01/09/2026', 'A', '10', '']], { ...m, balance: -1 })), null);
});

test('categorization rules match text regardless of case and accents', () => {
    const rules = [{ contains: 'farmacia', category: 'Salud' }, { contains: 'SUPERMAXI', category: 'Alimentación' }];
    assert.equal(I.applyRules(rules, 'Farmacia Fybeca').category, 'Salud');
    assert.equal(I.applyRules(rules, 'Compra supermaxí').category, 'Alimentación');
    assert.equal(I.applyRules(rules, 'Otra cosa'), null);
});

test('SRI electronic invoice (authorization file with CDATA)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<autorizacion><estado>AUTORIZADO</estado><numeroAutorizacion>0909202601179001691900120010010000123451234567811</numeroAutorizacion>
<comprobante><![CDATA[<?xml version="1.0" encoding="UTF-8"?><factura id="comprobante" version="1.1.0">
<infoTributaria><ambiente>2</ambiente><razonSocial>CORPORACION FAVORITA C.A.</razonSocial><nombreComercial>SUPERMAXI</nombreComercial>
<ruc>1790016919001</ruc><claveAcceso>0909202601179001691900120010010000123451234567811</claveAcceso><codDoc>01</codDoc>
<estab>001</estab><ptoEmi>001</ptoEmi><secuencial>000012345</secuencial></infoTributaria>
<infoFactura><fechaEmision>09/09/2026</fechaEmision><totalSinImpuestos>40.00</totalSinImpuestos>
<totalConImpuestos><totalImpuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><baseImponible>40.00</baseImponible><valor>6.00</valor></totalImpuesto></totalConImpuestos>
<importeTotal>46.00</importeTotal><pagos><pago><formaPago>19</formaPago><total>46.00</total></pago></pagos></infoFactura>
<detalles><detalle><descripcion>LECHE ENTERA 1L</descripcion><cantidad>2</cantidad><precioTotalSinImpuesto>2.00</precioTotalSinImpuesto></detalle>
<detalle><descripcion>ARROZ &amp; GRANOS</descripcion><cantidad>1</cantidad><precioTotalSinImpuesto>38.00</precioTotalSinImpuesto></detalle></detalles>
</factura>]]></comprobante></autorizacion>`;
    const f = I.parseSriXml(xml);
    assert.equal(f.supplier, 'SUPERMAXI');
    assert.equal(f.legalName, 'CORPORACION FAVORITA C.A.');
    assert.equal(f.ruc, '1790016919001');
    assert.equal(f.number, '001-001-000012345');
    assert.equal(f.date, '2026-09-09');
    assert.equal(f.total, 46);
    assert.equal(f.iva, 6);
    assert.equal(f.payment, 'Tarjeta de Crédito');
    assert.equal(f.items.length, 2);
    assert.equal(f.items[1].description, 'ARROZ & GRANOS');
    assert.equal(I.parseSriXml('<nota>hola</nota>'), null);
});

test('CSV export: quotes, BOM, numbers, and no formula injection', () => {
    const csv = I.toCSV([['Fecha', 'Descripción', 'Monto'], ['2026-09-01', 'Pan, leche', 12.5], ['2026-09-02', 'Dijo "hola"', -3], ['x', '=HYPERLINK("a")', 1]]);
    assert.ok(csv.startsWith('﻿'));
    const lines = csv.slice(1).trim().split('\r\n');
    assert.equal(lines[1], '2026-09-01,"Pan, leche",12.5');
    assert.equal(lines[2], '2026-09-02,"Dijo ""hola""",-3');
    assert.equal(lines[3], `x,"'=HYPERLINK(""a"")",1`);
    // Round-trips through our own importer.
    assert.deepEqual(I.parseCSV(csv).rows[1], ['2026-09-01', 'Pan, leche', '12.5']);
});

test('receipt text from a photo: total, date, RUC, store', () => {
    const text = `FARMACIAS FYBECA\nRUC: 1790710319001\nFACTURA 001-002-000045678\nFecha: 12/09/2026\nSUBTOTAL 20,00\nIVA 15% 3,00\nTOTAL 23,00\nGracias por su compra`;
    const r = I.parseReceiptText(text);
    assert.equal(r.total, 23);
    assert.equal(r.date, '2026-09-12');
    assert.equal(r.ruc, '1790710319001');
    assert.equal(r.merchant, 'FARMACIAS FYBECA');
});
