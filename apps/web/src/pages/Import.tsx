import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { MANUAL_CSV_COLUMNS, MANUAL_LIMITS, type ImportResponse } from '@va/shared';
import { getFilterOptions, importManualCsv, manualTemplateUrl } from '../api/client';
import { useApi } from '../api/useApi';
import { ErrorState } from '../components/States';
import { fmtDate } from '../format';

const PREVIEW_ROWS = 200;
const STATUS_LABEL = { valid: 'Valid', invalid: 'Invalid', duplicate: 'Duplicate' } as const;

export function ImportPage() {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [done, setDone] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opts = useApi(getFilterOptions, []);
  const mapName = (id: string) => opts.data?.catalog.maps.find((m) => m.id === id)?.name ?? id.split('/').pop() ?? id;
  const agentName = (id: string) => opts.data?.catalog.agents.find((a) => a.id === id)?.name ?? id;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setError(null);
    setPreview(null);
    setDone(null);
    setCsv(null);
    if (!file) return;
    if (file.size > MANUAL_LIMITS.importMaxBytes) {
      setError(`That file is too large. The limit is ${(MANUAL_LIMITS.importMaxBytes / 1_000_000).toFixed(0)} MB.`);
      e.target.value = '';
      return;
    }
    setFileName(file.name);
    setBusy(true);
    try {
      const text = await file.text();
      setCsv(text);
      setPreview(await importManualCsv({ csv: text, dryRun: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (csv == null) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await importManualCsv({ csv, dryRun: false }));
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const canImport = !!preview && preview.counts.invalid === 0 && preview.counts.valid > 0 && !busy;

  return (
    <div className="page">
      <h1>Import matches from CSV</h1>
      <p>
        Add many matches at once. Imported matches are saved as manual entries and labelled “Manual” — they are not Riot
        data. Download the template, fill it in, then choose the file. You will see a preview before anything is saved,
        and the import is all-or-nothing: if any row is invalid, nothing is imported.
      </p>
      <p>
        <a className="button secondary" href={manualTemplateUrl()} download>
          Download template
        </a>
      </p>

      <div className="table-wrap">
        <table>
          <caption>CSV columns (header row required; column order is free)</caption>
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col">Required</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
            {MANUAL_CSV_COLUMNS.map((c) => (
              <tr key={c.name}>
                <th scope="row">
                  <code>{c.name}</code>
                </th>
                <td>{c.required ? 'Yes' : 'No'}</td>
                <td>{c.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">Empty optional cells are treated as unknown, not zero. At most {MANUAL_LIMITS.importMaxRows} rows.</p>

      <label className="file-input">
        CSV file
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
      </label>

      {busy && (
        <p role="status" className="state">
          Working…
        </p>
      )}
      {error && <ErrorState error={{ message: error }} />}

      {done && (
        <p role="status" className="notice">
          Imported {done.imported} {done.imported === 1 ? 'match' : 'matches'}.{' '}
          <Link to="/matches?source=manual">View manual entries in Matches</Link>
        </p>
      )}

      {preview && (
        <section aria-labelledby="preview-h">
          <h2 id="preview-h">Preview{fileName ? `: ${fileName}` : ''}</h2>
          <p data-testid="import-counts">
            {preview.counts.valid} valid · {preview.counts.invalid} invalid · {preview.counts.duplicate} duplicate
          </p>
          {preview.counts.duplicate > 0 && (
            <p className="small">Duplicates already exist and will be skipped.</p>
          )}
          {preview.counts.invalid > 0 && (
            <p className="state-error" role="alert">
              Fix the invalid rows in your file and choose it again. Nothing is imported while any row is invalid.
            </p>
          )}
          <div className="table-wrap">
            <table>
              <caption>Import preview</caption>
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Status</th>
                  <th scope="col">Date</th>
                  <th scope="col">Map</th>
                  <th scope="col">Agent</th>
                  <th scope="col">Score</th>
                  <th scope="col">K/D/A</th>
                  <th scope="col">Errors</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, PREVIEW_ROWS).map((r) => {
                  const p = r.parsed;
                  return (
                    <tr key={r.line}>
                      <th scope="row">{r.line}</th>
                      <td>
                        <span className={`badge ${r.status === 'valid' ? '' : r.status === 'invalid' ? 'badge-warn' : 'badge-muted'}`}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td>{p ? fmtDate(p.date) : '—'}</td>
                      <td>{p ? mapName(p.mapId) : '—'}</td>
                      <td>{p ? agentName(p.agentId) : '—'}</td>
                      <td>{p ? `${p.roundsWon}–${p.roundsLost}` : '—'}</td>
                      <td>{p ? `${p.kills}/${p.deaths}/${p.assists}` : '—'}</td>
                      <td>
                        {r.errors.length > 0 ? (
                          <ul className="plain">
                            {r.errors.map((m, i) => (
                              <li key={i}>{m}</li>
                            ))}
                          </ul>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.rows.length > PREVIEW_ROWS && (
            <p className="small">
              Showing the first {PREVIEW_ROWS} of {preview.rows.length} rows. All rows are included in the import.
            </p>
          )}
          <div className="actions">
            <button type="button" disabled={!canImport} onClick={confirm}>
              Import {preview.counts.valid} {preview.counts.valid === 1 ? 'match' : 'matches'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
