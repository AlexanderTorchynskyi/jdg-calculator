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
  const values = { hours: saved ? decimal(saved.hours) : '', ...DEFAULTS };
  if (source) for (const key of SETTINGS) values[key] = decimal(source[key]);
  return { values, saved: Boolean(saved) };
}

export function emptyWorkspace() {
  return { revision: 0, records: [], defaults: [] };
}

export function summarizeEarnings(records) {
  const months = [...records]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((record) => ({ month: record.month, netto: calculate(record).netto }));
  const total = months.reduce((sum, entry) => sum + entry.netto, 0n);
  const count = BigInt(months.length);
  let average = 0n;
  if (count > 0n) {
    const magnitude = total < 0n ? -total : total;
    const rounded = (magnitude * 2n + count) / (count * 2n);
    average = total < 0n ? -rounded : rounded;
  }
  return { months, total, count: months.length, average };
}
