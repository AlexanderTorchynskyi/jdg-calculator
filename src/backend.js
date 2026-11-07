import { createClient } from '@supabase/supabase-js';
import { assertInputs } from './calculator.js';
import { decodeWorkspace, validMonth } from './workspace.js';

export function createBackend(url, key) {
  if (!url || !key) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new Error('Supabase must use HTTPS (except local development).');
  }
  const client = createClient(url, key);
  return {
    auth: client.auth,
    async load() {
      const { data, error } = await client.rpc('load_workspace');
      if (error) throw error;
      return decodeWorkspace(data);
    },
    async save(month, inputs, revision) {
      if (!validMonth(month)) throw new Error('Invalid month.');
      assertInputs(inputs);
      const { data, error } = await client.rpc('save_month', {
        p_month: `${month}-01`,
        p_hours: inputs.hours,
        p_rate: inputs.rate,
        p_tax: inputs.tax,
        p_accounting: inputs.accounting,
        p_card: inputs.card,
        p_zus: inputs.zus,
        p_revision: revision,
      });
      if (error) throw error;
      return decodeWorkspace(data);
    },
  };
}
