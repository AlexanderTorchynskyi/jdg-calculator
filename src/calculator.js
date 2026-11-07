export const FIELDS = {
  hours: { label: 'Working hours', max: 1_000_000 },
  rate: { label: 'Hourly rate', max: 1_000_000_000 },
  tax: { label: 'Income tax', max: 10_000 },
  accounting: { label: 'Accounting', max: 1_000_000_000 },
  card: { label: 'Card support', max: 1_000_000_000 },
  zus: { label: 'ZUS', max: 1_000_000_000 },
};

export const SETTINGS = ['rate', 'tax', 'accounting', 'card', 'zus'];
export const DEFAULTS = { rate: '155.00', tax: '10.50', accounting: '299.00', card: '9.00', zus: '2619.00' };

export function parseHundredths(value, field) {
  const text = String(value).trim().replace(',', '.');
  const spec = FIELDS[field];
  if (!spec) throw new Error(`Unknown field: ${field}`);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(`${spec.label}: enter a non-negative number with up to two decimal places.`);
  }
  const [whole, fraction = ''] = text.split('.');
  const parsed = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (parsed > BigInt(spec.max)) {
    throw new Error(`${spec.label}: maximum is ${spec.max / 100}.`);
  }
  return Number(parsed);
}

export function validateInputs(values) {
  const inputs = {};
  const errors = {};
  for (const field of Object.keys(FIELDS)) {
    try {
      inputs[field] = parseHundredths(values[field] ?? '', field);
    } catch (error) {
      errors[field] = error.message;
    }
  }
  return { inputs, errors, valid: Object.keys(errors).length === 0 };
}

export function assertInputs(inputs) {
  for (const [key, spec] of Object.entries(FIELDS)) {
    if (!Number.isSafeInteger(inputs[key]) || inputs[key] < 0 || inputs[key] > spec.max) {
      throw new Error(`Invalid stored ${spec.label.toLowerCase()}.`);
    }
  }
  return inputs;
}

export function decimal(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid decimal value.');
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

const roundHalfUp = (numerator, denominator) => (numerator + denominator / 2n) / denominator;

export function calculate(inputs) {
  assertInputs(inputs);
  const base = roundHalfUp(BigInt(inputs.rate) * BigInt(inputs.hours), 100n);
  const vat = roundHalfUp(base * 23n, 100n);
  const tax = roundHalfUp(base * BigInt(inputs.tax), 10_000n);
  const accounting = BigInt(inputs.accounting);
  const card = BigInt(inputs.card);
  const zus = BigInt(inputs.zus);
  return { base, vat, tax, accounting, card, zus, brutto: base + vat, netto: base - tax - accounting - card - zus };
}

const grouping = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

export function money(cents) {
  const amount = BigInt(cents);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${grouping.format(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')} PLN`;
}

export function settingsEqual(a, b) {
  return SETTINGS.every((key) => a[key] === b[key]);
}
