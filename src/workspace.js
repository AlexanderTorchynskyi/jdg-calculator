import { assertInputs, calculate, decimal, DEFAULTS, SETTINGS } from './calculator.js';

export function validMonth(value) {
  return typeof value === 'string' && /^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(value);
}

export function currentMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month) {
  if (!validMonth(month)) throw new Error('Invalid month.');
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}-01T00:00:00Z`));
}

export function decodeWorkspace(data) {
  if (!data || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
      !Array.isArray(data.records) || !Array.isArray(data.defaults)) {
    throw new Error('The database returned an invalid workspace.');
  }
  for (const collection of [data.records, data.defaults]) {
    const seen = new Set();
    for (const record of collection) {
      if (!validMonth(record.month) || seen.has(record.month)) throw new Error('Invalid stored month.');
      seen.add(record.month);
      assertInputs({ ...record, hours: collection === data.defaults ? 0 : record.hours });
    }
  }
  return data;
}

export function selectMonth(workspace, month) {
  if (!validMonth(month)) throw new Error('Select a valid month between 1000 and 9999.');
  const saved = workspace.records.find((record) => record.month === month);
  const defaults = workspace.defaults.filter((entry) => entry.month <= month)
    .sort((a, b) => b.month.localeCompare(a.month))[0];
  const source = saved ?? defaults;
  const display = (value, whole) => whole && value % 100 === 0 ? String(value / 100) : decimal(value);
  const values = { hours: saved ? display(saved.hours, true) : '', ...DEFAULTS };
  if (source) for (const key of SETTINGS) values[key] = display(source[key], key === 'rate');
  return { values, saved: Boolean(saved) };
}

export function emptyWorkspace() {
  return { revision: 0, records: [], defaults: [] };
}

function averageHalfUp(total, count) {
  if (count === 0) return 0n;
  const divisor = BigInt(count);
  const magnitude = total < 0n ? -total : total;
  const rounded = (magnitude * 2n + divisor) / (divisor * 2n);
  return total < 0n ? -rounded : rounded;
}

// Months with no invoice (zero brutto) are left out of invoice averages.
function invoiceStats(entries) {
  const invoiced = entries.filter((entry) => entry.brutto > 0n);
  const total = invoiced.reduce((sum, entry) => sum + entry.brutto, 0n);
  return { invoiceCount: invoiced.length, averageInvoice: averageHalfUp(total, invoiced.length) };
}

export function summarizeEarnings(records) {
  const months = [...records]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((record) => {
      const result = calculate(record);
      return { month: record.month, netto: result.netto, brutto: result.brutto };
    });
  const total = months.reduce((sum, entry) => sum + entry.netto, 0n);
  const byYear = new Map();
  for (const entry of months) {
    const year = entry.month.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), entry]);
  }
  const years = [...byYear].map(([year, entries]) => ({
    year,
    count: entries.length,
    average: averageHalfUp(entries.reduce((sum, entry) => sum + entry.netto, 0n), entries.length),
    ...invoiceStats(entries),
  }));
  return {
    months, years, total, count: months.length,
    average: averageHalfUp(total, months.length),
    ...invoiceStats(months),
  };
}
