import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, DEFAULTS, decimal, FIELDS, money, parseHundredths, validateInputs } from '../src/calculator.js';
import { currentMonth, decodeWorkspace, emptyWorkspace, selectMonth, validMonth } from '../src/workspace.js';

const sample = (values = {}) => validateInputs({ hours: '160', ...DEFAULTS, rate: '100', ...values }).inputs;

test('exact custom formula: 160 hours at PLN 100', () => {
  assert.deepEqual(calculate(sample()), {
    base: 1_600_000n, vat: 368_000n, tax: 168_000n,
    accounting: 29_900n, card: 900n, zus: 261_900n,
    brutto: 1_968_000n, netto: 1_139_300n,
  });
});

test('fractional hours, comma decimals and half-up rounding reconcile', () => {
  const inputs = sample({ hours: '1,25', rate: '0.02', tax: '50', accounting: '0', card: '0', zus: '0' });
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
    assert.equal(parseHundredths(decimal(spec.max), key), spec.max);
    assert.throws(() => parseHundredths(decimal(spec.max + 1), key));
  }
  assert.equal(validateInputs({}).valid, false);
  assert.throws(() => calculate({ ...sample(), hours: 1.5 }));
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
  assert.equal(selectMonth(workspace, '2026-03').values.rate, '100.00');
  assert.equal(selectMonth(workspace, '2026-05').values.rate, '200.00');
  assert.equal(selectMonth(workspace, '2026-05').values.zus, '3000.00');
  assert.equal(selectMonth(workspace, '2026-06').values.rate, '100.00');
  assert.equal(selectMonth(workspace, '2026-06').values.hours, '120.00');
  assert.equal(selectMonth(workspace, '2026-05').saved, false);
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
