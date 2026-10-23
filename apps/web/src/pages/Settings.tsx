import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { LinkState, ShareField, ShareLinkDto, SyncResponse } from '@va/shared';
import {
  connectRiot,
  createShareLink,
  deleteAllManualMatches,
  exportCsvUrl,
  getShareLinks,
  getSyncJob,
  logout,
  revokeShareLink,
  startSync,
  unlinkAccount,
} from '../api/client';
import { useApi } from '../api/useApi';
import { parseFilter } from '../filters';
import { fmtDateTime } from '../format';
import { useMe } from '../me';
import { ErrorState, Query } from '../components/States';

export const LINK_STATE_LABELS: Record<LinkState, string> = {
  unlinked: 'Not linked',
  linked: 'Linked',
  syncing: 'Syncing match history…',
  up_to_date: 'Linked and up to date',
  consent_removed: 'Consent removed. Link again to resume syncing.',
  sync_failed: 'Last sync failed',
};

const SHARE_FIELDS: { key: ShareField; label: string }[] = [
  { key: 'matchCount', label: 'Match count' },
  { key: 'winRate', label: 'Win rate' },
  { key: 'kd', label: 'K/D' },
  { key: 'topAgents', label: 'Top agents' },
  { key: 'topMaps', label: 'Top maps' },
];

function AccountSection() {
  const { me, reloadMe } = useMe();
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncResponse | null>(null);
  const linked = me.link.state !== 'unlinked' && me.link.state !== 'consent_removed';

  useEffect(() => {
    if (!sync || (sync.state !== 'queued' && sync.state !== 'running')) return;
    const t = window.setTimeout(() => {
      getSyncJob(sync.jobId).then(
        (s) => {
          setSync(s);
          if (s.state === 'succeeded' || s.state === 'failed') reloadMe();
        },
        (e: Error) => setError(e.message),
      );
    }, 2000);
    return () => window.clearTimeout(t);
  }, [sync, reloadMe]);

  const run = (p: Promise<unknown>) => p.catch((e: Error) => setError(e.message));
  const syncing = sync?.state === 'queued' || sync?.state === 'running';

  return (
    <section className="card" aria-labelledby="acct">
      <h2 id="acct">Riot account</h2>
      <p>
        Status: <strong>{LINK_STATE_LABELS[me.link.state]}</strong>
      </p>
      <dl className="facts">
        <dt>Riot ID</dt>
        <dd>{me.link.riotId ?? '—'}</dd>
        <dt>Region</dt>
        <dd>{me.link.region ?? '—'}</dd>
        <dt>Last synced</dt>
        <dd>{fmtDateTime(me.link.lastSyncedAt)}</dd>
        <dt>Consent given</dt>
        <dd>{fmtDateTime(me.link.consentedAt)}</dd>
      </dl>
      {me.link.lastError && <p className="state-error">Last error: {me.link.lastError}</p>}
      {error && <ErrorState error={{ message: error }} />}

      {!linked && (
        <>
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I consent to
            VALORANT Analyzer reading my own match history from Riot to calculate statistics and insights.
          </label>
          <button
            type="button"
            disabled={!consent}
            onClick={() =>
              run(connectRiot().then((r) => window.location.assign(r.redirectUrl)))
            }
          >
            Link Riot account
          </button>
        </>
      )}

      {linked && (
        <div className="actions">
          <button type="button" disabled={syncing} onClick={() => run(startSync().then(setSync))}>
            Sync now
          </button>
          {sync && (
            <span role="status" className="small">
              Sync {sync.state}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function ExportSection() {
  const [sp] = useSearchParams();
  return (
    <section className="card" aria-labelledby="exp">
      <h2 id="exp">Export</h2>
      <p>Download your analyzed matches as CSV (uses the filters currently in the address bar).</p>
      <a className="button" href={exportCsvUrl(parseFilter(sp))} download>
        Export CSV
      </a>
    </section>
  );
}

function ShareSection() {
  const links = useApi(getShareLinks, []);
  const [fields, setFields] = useState<ShareField[]>(['matchCount', 'winRate']);
  const [days, setDays] = useState('30');
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (f: ShareField) =>
    setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  return (
    <section className="card" aria-labelledby="share">
      <h2 id="share">Share links</h2>
      <p className="small">Public links show only the fields you choose, never other players.</p>
      <fieldset>
        <legend>Fields to include</legend>
        {SHARE_FIELDS.map((f) => (
          <label key={f.key} className="check">
            <input type="checkbox" checked={fields.includes(f.key)} onChange={() => toggle(f.key)} />
            {f.label}
          </label>
        ))}
      </fieldset>
      <label>
        Expires
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">in 7 days</option>
          <option value="30">in 30 days</option>
          <option value="90">in 90 days</option>
          <option value="">never</option>
        </select>
      </label>
      <button
        type="button"
        disabled={fields.length === 0}
        onClick={() => {
          setError(null);
          createShareLink({ fields, ...(days ? { expiresInDays: Number(days) } : {}) }).then(
            (l) => {
              setCreatedUrl(l.url ?? null);
              links.reload();
            },
            (e: Error) => setError(e.message),
          );
        }}
      >
        Create share link
      </button>
      {createdUrl && (
        <p role="status" className="notice">
          Your link (shown only once): <code>{createdUrl}</code>
        </p>
      )}
      {error && <ErrorState error={{ message: error }} />}
      <Query state={links}>
        {(items: ShareLinkDto[]) =>
          items.length === 0 ? (
            <p className="small">No share links yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <caption>Your share links</caption>
                <thead>
                  <tr>
                    <th scope="col">Fields</th>
                    <th scope="col">Created</th>
                    <th scope="col">Expires</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((l) => (
                    <tr key={l.id}>
                      <td>{l.fields.join(', ')}</td>
                      <td>{fmtDateTime(l.createdAt)}</td>
                      <td>{l.expiresAt ? fmtDateTime(l.expiresAt) : 'Never'}</td>
                      <td>{l.revoked ? 'Revoked' : 'Active'}</td>
                      <td>
                        {!l.revoked && (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => revokeShareLink(l.id).then(links.reload, (e: Error) => setError(e.message))}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Query>
    </section>
  );
}

function ManualSection() {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  return (
    <section className="card" aria-labelledby="manual-entries">
      <h2 id="manual-entries">Manual entries</h2>
      <p>
        Matches you typed in or imported from CSV are always labelled “Manual”. They are kept if you unlink your Riot
        account.
      </p>
      <p>
        <Link to="/matches?source=manual">View manual entries</Link> · <Link to="/matches/new">Add match</Link> ·{' '}
        <Link to="/import">Import CSV</Link>
      </p>
      {error && <ErrorState error={{ message: error }} />}
      {done && (
        <p role="status" className="notice">
          All manual entries were deleted.
        </p>
      )}
      {!confirming && (
        <button type="button" className="danger" onClick={() => { setDone(false); setConfirming(true); }}>
          Delete all manual entries
        </button>
      )}
      {confirming && (
        <div role="alertdialog" aria-labelledby="mdel-title" aria-describedby="mdel-desc" className="confirm">
          <h3 id="mdel-title">Delete all manual entries?</h3>
          <p id="mdel-desc">
            This permanently deletes every manual entry. It cannot be undone. Data from Riot is not affected.
          </p>
          <div className="actions">
            <button
              type="button"
              className="danger"
              onClick={() =>
                deleteAllManualMatches().then(
                  () => {
                    setConfirming(false);
                    setDone(true);
                  },
                  (e: Error) => {
                    setError(e.message);
                    setConfirming(false);
                  },
                )
              }
            >
              Yes, delete all manual entries
            </button>
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function DangerSection() {
  const { me, reloadMe } = useMe();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card" aria-labelledby="danger">
      <h2 id="danger">Account & data</h2>
      {error && <ErrorState error={{ message: error }} />}
      {me.link.state !== 'unlinked' && !confirming && (
        <button type="button" className="danger" onClick={() => setConfirming(true)}>
          Unlink & delete data
        </button>
      )}
      {confirming && (
        <div role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-desc" className="confirm">
          <h3 id="confirm-title">Delete your data?</h3>
          <p id="confirm-desc">
            This unlinks your Riot account and permanently deletes all stored Riot match data. Your manual entries are
            kept. It cannot be undone.
          </p>
          <div className="actions">
            <button
              type="button"
              className="danger"
              onClick={() =>
                unlinkAccount().then(
                  () => {
                    setConfirming(false);
                    reloadMe();
                  },
                  (e: Error) => setError(e.message),
                )
              }
            >
              Yes, delete everything
            </button>
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <p>
        <button type="button" className="secondary" onClick={() => logout().finally(() => window.location.assign('/'))}>
          Sign out
        </button>
      </p>
    </section>
  );
}

export function Settings() {
  const [sp] = useSearchParams();
  return (
    <div className="page">
      <h1>Account & Settings</h1>
      {sp.get('linked') && (
        <p role="status" className="notice">
          Riot account linked.
        </p>
      )}
      {sp.get('error') && (
        <p role="alert" className="state-error">
          Linking failed ({sp.get('error')}). Please try again.
        </p>
      )}
      <AccountSection />
      <ExportSection />
      <ShareSection />
      <ManualSection />
      <DangerSection />
    </div>
  );
}
