import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, DEFAULTS, decimal, FIELDS, money, parseHundredths, validateInputs } from '../src/calculator.js';
import { currentMonth, decodeWorkspace, emptyWorkspace, selectMonth, summarizeEarnings, validMonth } from '../src/workspace.js';

const sample = (values = {}) => validateInputs({ hours: '160', ...DEFAULTS, rate: '100', ...values }).inputs;

test('exact custom formula: 160 hours at PLN 100', () => {
  assert.deepEqual(calculate(sample()), {
    base: 1_600_000n, vat: 368_000n, tax: 164_000n,
    accounting: 29_900n, card: 900n, zus: 261_900n,
    brutto: 1_968_000n, netto: 1_143_300n,
  });
});

test('legacy fractional hours and rates still calculate with half-up rounding', () => {
  const inputs = { ...sample({ tax: '50', accounting: '0', card: '0', zus: '0' }), hours: 125, rate: 2 };
  const result = calculate(inputs);
  assert.equal(result.base, 3n);
  assert.equal(result.vat, 1n);
  assert.equal(result.tax, 2n);
  assert.equal(result.brutto, 4n);
  assert.equal(result.netto, 1n);
});

test('zero hours retains all fixed deductions and negative netto', () => {
  const result = calculate(sample({ hours: '0' }));
  assert.equal(result.brutto, 0n);
  assert.equal(result.netto, -292_700n);
  assert.equal(money(-1n), '-0.01 PLN');
});

test('editable deductions and tax are applied to base, not invoice', () => {
  const result = calculate(sample({ hours: '10', rate: '100', tax: '20', accounting: '100', card: '5', zus: '500' }));
  assert.equal(result.brutto, 123_000n);
  assert.equal(result.tax, 20_000n);
  assert.equal(result.netto, 19_500n);
});

test('all numeric fields reject missing, malformed, negative, excess precision and excessive values', () => {
  for (const [key, spec] of Object.entries(FIELDS)) {
    for (const value of ['', ' ', '-1', 'Infinity', 'NaN', '1e3', '1.234', '1.2.3', '+2', '.5', '1,2.3', 'x']) {
      assert.throws(() => parseHundredths(value, key), undefined, `${key}: ${value}`);
    }
    assert.equal(parseHundredths(spec.whole ? String(spec.max / 100) : decimal(spec.max), key), spec.max);
    assert.throws(() => parseHundredths(spec.whole ? String(spec.max / 100 + 1) : decimal(spec.max + 1), key), /maximum/);
  }
  assert.equal(validateInputs({}).valid, false);
  assert.throws(() => calculate({ ...sample(), hours: 1.5 }));
});

test('hours and rate require whole numbers while deductions retain decimals', () => {
  for (const field of ['hours', 'rate']) {
    for (const value of ['1.5', '1,5', '1.00', '1,00']) {
      assert.throws(() => parseHundredths(value, field), /whole number/);
    }
    assert.equal(parseHundredths('0', field), 0);
    assert.equal(parseHundredths('123', field), 12300);
  }
  assert.equal(parseHundredths('10,25', 'tax'), 1025);
  assert.equal(parseHundredths('1.50', 'zus'), 150);
});

test('large permitted values remain exact', () => {
  const result = calculate(sample({ rate: '10000000', hours: '10000', tax: '0', accounting: '0', card: '0', zus: '0' }));
  assert.equal(result.base, 10_000_000_000_000n);
  assert.equal(result.brutto, 12_300_000_000_000n);
  assert.ok(money(result.brutto).endsWith('.00 PLN'));
});

test('effective defaults affect unsaved months and never replace saved snapshots', () => {
  const first = { month: '2026-01', ...sample() };
  const changed = { ...first, month: '2026-04', rate: 20_000, zus: 300_000 };
  const savedFuture = { ...first, month: '2026-06', hours: 12_000 };
  const workspace = { revision: 2, records: [first, savedFuture], defaults: [first, changed] };
  assert.equal(selectMonth(workspace, '2025-12').values.rate, '');
  assert.equal(selectMonth(workspace, '2026-03').values.rate, '100');
  assert.equal(selectMonth(workspace, '2026-05').values.rate, '200');
  assert.equal(selectMonth(workspace, '2026-05').values.zus, '3000.00');
  assert.equal(selectMonth(workspace, '2026-06').values.rate, '100');
  assert.equal(selectMonth(workspace, '2026-06').values.hours, '120');
  assert.equal(selectMonth(workspace, '2026-05').saved, false);
});

test('fresh months require a rate while saved rates remain unchanged', () => {
  for (const month of ['2025-01', '2026-11', '2027-12']) {
    const selected = selectMonth(emptyWorkspace(), month);
    assert.equal(selected.values.rate, '');
    assert.equal(selected.values.hours, '');
    assert.equal(selected.saved, false);
  }
  const saved = { month: '2026-11', ...sample({ rate: '80' }) };
  assert.equal(selectMonth({ revision: 1, records: [saved], defaults: [] }, saved.month).values.rate, '80');
});

test('legacy fractional snapshots and defaults remain intact and visible', () => {
  const record = { month: '2026-01', ...sample(), hours: 16050, rate: 10025 };
  const workspace = decodeWorkspace({ revision: 1, records: [record], defaults: [record] });
  assert.equal(selectMonth(workspace, '2026-01').values.hours, '160.50');
  assert.equal(selectMonth(workspace, '2026-01').values.rate, '100.25');
  assert.equal(selectMonth(workspace, '2026-02').values.rate, '100.25');
  assert.equal(summarizeEarnings(workspace.records).total, calculate(record).netto);
});
test('working hours alone cannot produce earnings without an hourly rate', () => {
  const result = validateInputs({ ...DEFAULTS, hours: '160' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.rate);
});

test('built-in tax is 10.25% without overwriting saved or inherited tax', () => {
  assert.equal(selectMonth(emptyWorkspace(), '2026-11').values.tax, '10.25');
  const record = { month: '2026-01', ...sample({ tax: '10.50' }) };
  const workspace = { revision: 1, records: [record], defaults: [record] };
  assert.equal(selectMonth(workspace, '2025-12').values.tax, '10.25');
  assert.equal(selectMonth(workspace, '2026-01').values.tax, '10.50');
  assert.equal(selectMonth(workspace, '2026-02').values.tax, '10.50');
});

test('workspace rejects malformed backend records rather than using silent defaults', () => {
  assert.deepEqual(decodeWorkspace(emptyWorkspace()), emptyWorkspace());
  assert.throws(() => decodeWorkspace({ revision: '0', records: [], defaults: [] }));
  assert.throws(() => decodeWorkspace({ revision: 0, records: [{ ...sample(), month: '2026-13' }], defaults: [] }));
  assert.throws(() => decodeWorkspace({ revision: 0, records: [{ ...sample(), month: '2026-01', rate: null }], defaults: [] }));
  assert.throws(() => decodeWorkspace({ revision: 0, records: [], defaults: [{ ...sample(), month: '2026-01' }, { ...sample(), month: '2026-01' }] }));
});

test('calendar validation and local current month', () => {
  assert.equal(currentMonth(new Date(2026, 10, 7)), '2026-11');
  assert.equal(validMonth('2026-11'), true);
  for (const month of ['2026-00', '2026-13', '026-11', '0000-01', '2026-1', '2026-11-01']) {
    assert.equal(validMonth(month), false);
  }
  assert.throws(() => selectMonth(emptyWorkspace(), '2026-13'));
});

test('earnings summary totals netto across months, newest first', () => {
  const record = (month, values) => ({ month, ...sample(values) });
  assert.deepEqual(summarizeEarnings([]), { months: [], total: 0n, count: 0, average: 0n });
  const summary = summarizeEarnings([
    record('2026-01', { hours: '160' }),
    record('2026-03', { hours: '0' }),
    record('2026-02', { hours: '120' }),
  ]);
  assert.deepEqual(summary.months.map((entry) => entry.month), ['2026-03', '2026-02', '2026-01']);
  assert.deepEqual(summary.months.map((entry) => entry.netto), [-292_700n, 784_300n, 1_143_300n]);
  assert.equal(summary.total, 1_634_900n);
  assert.equal(summary.count, 3);
  assert.equal(summary.average, 544_967n);
});

test('earnings average rounds half away from zero', () => {
  const record = (month, zus) => ({ month, ...sample({ hours: '0', accounting: '0', card: '0', zus }) });
  assert.equal(summarizeEarnings([record('2026-01', '0.01'), record('2026-02', '0')]).average, -1n);
  assert.equal(summarizeEarnings([record('2026-01', '0.02'), record('2026-02', '0')]).average, -1n);
});
