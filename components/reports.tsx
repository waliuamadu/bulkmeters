'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
export function Reports() {
  const [dataset, setDataset] = useState('registry'),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const q = new URLSearchParams({ dataset });
  if (from) q.set('from', from + 'T00:00:00Z');
  if (to) q.set('to', to + 'T23:59:59Z');
  return (
    <section className="card">
      <div className="cardtitle">
        <div>
          <h2>Export operational data</h2>
          <p className="muted">
            Exports enforce your permissions and region or facility scope.
          </p>
        </div>
      </div>
      <div className="formgrid">
        <label className="field">
          Dataset
          <select value={dataset} onChange={(e) => setDataset(e.target.value)}>
            {[
              ['registry', 'Meter registry'],
              ['latest', 'Latest readings'],
              ['offline', 'Offline meters'],
              ['history', 'Reading history'],
              ['transmissions', 'Transmission history'],
              [
                'unidentified',
                'Unidentified identities (registry access required)',
              ],
              ['quality', 'Data quality exceptions'],
            ].map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Start date (UTC)
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="field">
          End date (UTC)
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <p className="full muted">
          Date filters apply to historical readings, transmissions, and quality
          events. Exports exceeding 100,000 rows require a narrower period.
        </p>
        <div className="actions full">
          <a className="download" href={'/api/export?' + q + '&format=csv'}>
            Download CSV
          </a>
          <a className="download" href={'/api/export?' + q + '&format=xlsx'}>
            Download Excel
          </a>
        </div>
      </div>
    </section>
  );
}
