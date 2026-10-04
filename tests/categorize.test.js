// The statement reader: clean names, direction, card category codes, guesses, payers, rules.
// Every line here is invented, in the formats banks and card issuers use.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/categorize.js');
const I = require('../js/importers.js');

const g = (text, sign) => { const info = C.parse(text); return Object.assign(C.guess(info, { sign }), { name: info.name }); };

test('bank lines: payer, direction and what it is', () => {
    let r = g('DEPOSIT ACME TOOLS INC<br />TYPE: REG.SALARY  ID: 999000111A<br />DATA: *0000*0001<br />CO: ACME TOOLS INC<br />%% ACH ECC PPD<br />%% ACH Trace *000000001', 1);
    assert.deepEqual([r.name, r.type, r.category, r.sub, r.confidence], ['Acme Tools', 'Ingreso', 'Ingresos Laborales', 'Sueldo/Salario', 'high']);
    r = g('DEPOSIT GLOBEX CORP,-XYZ<br />TYPE: XXXXXX0001  ID: 00000001<br />CO: GLOBEX CORP,-XYZ<br />%% ACH ECC PPD', 1);
    assert.equal(r.name, 'Globex'); assert.equal(r.confidence, 'low');           // no PAYROLL word yet
    r = g('WITHDRAWAL FIDELITY BUY<br />TYPE: INVESTMENT  ID: ABC PUR<br />DATA: INDIVIDUAL BUY  CO: FIDELITY BUY', -1);
    assert.deepEqual([r.name, r.category, r.sub], ['Fidelity', 'Ahorro e Inversión', 'Inversiones (bolsa)']);
    assert.equal(g('WITHDRAWAL FIRST BANK MORTGAGE<br />TYPE: PAYMENT  ID: *0001<br />CO: FIRST BANK MORTGAGE', -1).sub, 'Hipoteca');
    assert.equal(g('WITHDRAWAL CITY POWER CO<br />TYPE: ENERGYBILL  ID: *0001<br />CO: CITY POWER CO', -1).sub, 'Energía Eléctrica');
    assert.equal(g('WITHDRAWAL CITY OF SPRINGFIELD<br />TYPE: DEBIT  ID: *XXXX<br />DATA: WATER/SEWER  CO: CITY OF SPRINGFIELD', -1).sub, 'Agua');
    assert.equal(g('DEPOSIT IRS  TREAS 310<br />TYPE: TAX REF  ID: *0001<br />CO: IRS  TREAS 310', 1).sub, 'Reembolso de Impuestos (IRS)');
    assert.equal(g('Deposit Dividend<br />%% APY Earned  3.00% 01/01/26 to 01/31/26', 1).sub, 'Intereses');
    r = g('Withdrawal Transfer To Loan 01<br />CONFIRMATION #: ABC123XYZ000<br />Credit Card Payment', -1);
    assert.deepEqual([r.type, r.name], ['Transferencia', 'Credit Card Payment']);
    assert.equal(g('Deposit Transfer<br />From Doe,Jane XXXXXX0000 Share 01<br />CONFIRMATION #: XYZ<br />new couch', 1).name, 'new couch');
    r = g('WITHDRAWAL, DRAFT NUMBER 2001<br />WITHDRAWAL, DRAFT NUMBER 2001', -1);
    assert.equal(r.confidence, 'low'); assert.match(r.why, /2001/); assert.equal(r.key, '');
    assert.equal(g('Withdrawal<br />Withdrawal', -1).confidence, 'low');
    // With no sign in the file, the words decide.
    assert.equal(g('DEPOSIT ACME TOOLS INC<br />TYPE: PAYROLL', 0).type, 'Ingreso');
    assert.equal(g('WITHDRAWAL CITY POWER CO<br />TYPE: BILLPAY', 0).type, 'Gasto');
});

test('card lines: merchant name and the category code', () => {
    let r = g('Card purchase<br />KROGER #123 SPRINGFIELD IL<br />Date 03/14/26 *0000*1234567 5411<br />%% Card 01 #XXX1', -1);
    assert.deepEqual([r.name, r.category, r.sub, r.confidence], ['Kroger', 'Alimentación', 'Mercado/Supermercado', 'high']);
    r = g('Card purchase<br />MEIJER EXPRESS 101 LANSING MI<br />Date 03/14/26 *0000*1234567 5542', -1);
    assert.deepEqual([r.name, r.sub], ['Meijer', 'Gasolina/Diesel']);                   // same store, gas station code
    r = g('Card purchase<br />GOLDEN DRAGON 217-5550100 IL<br />Date 03/14/26 *0000*1234567 5812', -1);
    assert.deepEqual([r.name, r.sub], ['Golden Dragon', 'Restaurantes']);
    assert.equal(g('Card purchase<br />1234 SUPERCUTS AT PLAZA SPRINGFIELD IL<br />Date 03/14/26 *0000*1234567 7230', -1).sub, 'Peluquería/Barbería');
    assert.equal(g('Card purchase<br />PAYPAL *LYFT RIDE MON 1 555-555-0100 CA<br />Date 03/14/26 *0000*1234567 4121', -1).name, 'Lyft');
    r = g('Card purchase<br />AMAZON MKTPL*AB12CD34E Amzn.com/bill WA<br />Date 03/14/26 *0000*1234567 5942', -1);
    assert.deepEqual([r.name, r.confidence, !!r.ask], ['Amazon', 'low', true]);         // sells everything: ask
    assert.equal(g('Bill Payment #*000001<br />PROGRESSIVE *INSURANCE 800-555-0100 OH', -1).sub, 'Seguro Vehicular');
    assert.equal(g('Payments Transfer From Share 01<br />CONFIRMATION #: 001<br />Credit Card Payment', 1).type, 'Transferencia');
    assert.equal(g('Card purchase<br />VISA INTERNATIONAL SERVICE ASSESSMENT<br />Date 03/14/26 *1*2 0000', -1).sub, 'Comisiones Bancarias');
    assert.equal(g('Card purchase<br />SQ *PAY PARKING BY PHONE Springfield IL<br />Date 03/14/26 *1*2 9399', -1).sub, 'Parqueo');
});

test('Spanish bank lines (Ecuador)', () => {
    assert.deepEqual([g('COMPRA SUPERMAXI EL BOSQUE', -1).name, g('COMPRA SUPERMAXI EL BOSQUE', -1).category], ['Supermaxi', 'Alimentación']);
    assert.equal(g('PAGO CNT INTERNET', -1).sub, 'Internet');
    assert.equal(g('TRANSFERENCIA RECIBIDA JUAN', 1).name, 'Juan');
    assert.equal(g('RETIRO CAJERO', -1).name, 'Retiro de efectivo');
    assert.equal(g('SQ *SQ *COZY COFFEE', -1).name, 'Cozy Coffee');
});

test('same payer agrees; cities learned from the file; rule suggestions', () => {
    const lines = ['DEPOSIT GLOBEX CORP<br />TYPE: XXXX0001<br />CO: GLOBEX CORP', 'DEPOSIT GLOBEX CORP<br />TYPE: PAYROLL001<br />CO: GLOBEX CORP', 'DEPOSIT GLOBEX CORP<br />TYPE: XXXX0002<br />CO: GLOBEX CORP'];
    const gs = C.harmonize(lines.map(l => C.guess(C.parse(l), { sign: 1 })));
    assert.ok(gs.every(x => x.sub === 'Sueldo/Salario'));
    const regular = C.harmonize(['A', 'B', 'C'].map(() => C.guess(C.parse('DEPOSIT INITECH LLC<br />CO: INITECH LLC'), { sign: 1 })));
    assert.ok(regular.every(x => x.sub === 'Sueldo/Salario' && x.confidence === 'medium'));   // 3 deposits from one company
    const infos = ['TACO PLACE SPRINGFIELD', 'NOODLE BAR SPRINGFIELD', 'BOB BURGERS SPRINGFIELD', 'PIE SHOP'].map(m => C.parse(`Card purchase<br />${m} IL<br />Date 03/14/26 *1*2 5812`));
    assert.deepEqual(C.tidyNames(infos), ['springfield']);
    assert.deepEqual(infos.map(i => i.name), ['Taco Place', 'Noodle Bar', 'Bob Burgers', 'Pie Shop']);
    const rows = [{ key: 'Kroger', type: 'Gasto', category: 'Alimentación', sub: 'Mercado/Supermercado' }, { key: 'kroger', type: 'Gasto', category: 'Alimentación', sub: 'Mercado/Supermercado' }, { key: 'Lyft', type: 'Gasto', category: 'Transporte', sub: 'Taxi' }];
    assert.deepEqual(C.suggestRules(rows).map(x => [x.key, x.count]), [['Kroger', 2]]);
    assert.deepEqual(C.suggestRules(rows, [{ contains: 'kroger' }]), []);               // already a rule
});

test('importer: US month-first dates, ($1,234.56) is money out', () => {
    assert.equal(I.detectDateOrder(['7/7/2025', '7/31/2025'], 'dmy'), 'mdy');
    assert.equal(I.detectDateOrder(['31/7/2025'], 'mdy'), 'dmy');
    assert.equal(I.detectDateOrder(['7/7/2025'], 'mdy'), 'mdy');
    const rows = I.buildRows([['7/10/2025', 'x', '($11,222.33)'], ['7/31/2025', 'y', '$1,250.00']], { date: 0, description: 1, amount: 2, mode: 'single', dateDefault: 'mdy' });
    assert.deepEqual(rows.map(r => [r.date, r.type, r.amount]), [['2025-07-10', 'Gasto', 11222.33], ['2025-07-31', 'Ingreso', 1250]]);
});
