import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MANUAL_LIMITS, MANUAL_QUEUES, type ManualMatchDto, type ManualMatchInput } from '@va/shared';
import { ApiClientError, createManualMatch, getFilterOptions, updateManualMatch } from '../api/client';
import { useApi } from '../api/useApi';
import { Query } from './States';

export interface FormValues {
  date: string;
  time: string;
  mapId: string;
  agentId: string;
  queueId: string;
  patch: string;
  roundsWon: string;
  roundsLost: string;
  kills: string;
  deaths: string;
  assists: string;
  acs: string;
  adr: string;
  firstKills: string;
  firstDeaths: string;
  note: string;
}

export type FormErrors = Partial<Record<keyof FormValues, string>>;

export function todayLocal(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function emptyValues(): FormValues {
  return {
    date: todayLocal(), time: '', mapId: '', agentId: '', queueId: 'competitive', patch: '',
    roundsWon: '', roundsLost: '', kills: '', deaths: '', assists: '',
    acs: '', adr: '', firstKills: '', firstDeaths: '', note: '',
  };
}

const str = (n: number | null | undefined) => (n == null ? '' : String(n));

export function valuesFromDto(m: ManualMatchDto): FormValues {
  const d = new Date(m.startedAt);
  const iso = d.toISOString();
  const time = iso.slice(11, 19) === '12:00:00' ? '' : iso.slice(11, 16);
  return {
    date: iso.slice(0, 10), time, mapId: m.mapId, agentId: m.agentId, queueId: m.queueId, patch: m.patch ?? '',
    roundsWon: str(m.roundsWon), roundsLost: str(m.roundsLost), kills: str(m.kills), deaths: str(m.deaths),
    assists: str(m.assists), acs: str(m.acs), adr: str(m.adr), firstKills: str(m.firstKills),
    firstDeaths: str(m.firstDeaths), note: m.note ?? '',
  };
}

const WHOLE = /^\d+$/;

function whole(raw: string, label: string, max: number, required: boolean): { value: number | null; error?: string } {
  const v = raw.trim();
  if (v === '') return required ? { value: null, error: `${label} is required.` } : { value: null };
  if (!WHOLE.test(v)) return { value: null, error: `${label} must be a whole number.` };
  const n = Number(v);
  if (n > max) return { value: null, error: `${label} must be between 0 and ${max}.` };
  return { value: n };
}

/** Client-side validation mirroring MANUAL_LIMITS. Returns errors keyed by field; empty = valid. */
export function validate(v: FormValues, today = todayLocal()): { errors: FormErrors; input: ManualMatchInput | null } {
  const errors: FormErrors = {};
  const L = MANUAL_LIMITS;

  if (!v.date) errors.date = 'Date is required.';
  else if (v.date < L.minDate) errors.date = `Date can’t be before ${L.minDate}.`;
  else if (v.date > today) errors.date = 'Date can’t be in the future.';
  if (!v.mapId) errors.mapId = 'Choose a map.';
  if (!v.agentId) errors.agentId = 'Choose an agent.';
  if (!(MANUAL_QUEUES as readonly string[]).includes(v.queueId)) errors.queueId = 'Choose a queue.';

  const rw = whole(v.roundsWon, 'Rounds won', L.maxRoundsPerSide, true);
  const rl = whole(v.roundsLost, 'Rounds lost', L.maxRoundsPerSide, true);
  const k = whole(v.kills, 'Kills', L.maxKda, true);
  const d = whole(v.deaths, 'Deaths', L.maxKda, true);
  const a = whole(v.assists, 'Assists', L.maxKda, true);
  const acs = whole(v.acs, 'ACS', L.maxAcs, false);
  const adr = whole(v.adr, 'ADR', L.maxAdr, false);
  if (rw.error) errors.roundsWon = rw.error;
  if (rl.error) errors.roundsLost = rl.error;
  if (k.error) errors.kills = k.error;
  if (d.error) errors.deaths = d.error;
  if (a.error) errors.assists = a.error;
  if (acs.error) errors.acs = acs.error;
  if (adr.error) errors.adr = adr.error;

  const total = (rw.value ?? 0) + (rl.value ?? 0);
  if (rw.value != null && rl.value != null && total < 1) errors.roundsWon = 'Rounds won and lost must add up to at least 1.';
  const maxFirst = Math.max(total, 0);
  const fk = whole(v.firstKills, 'First kills', maxFirst || L.maxRoundsPerSide * 2, false);
  const fd = whole(v.firstDeaths, 'First deaths', maxFirst || L.maxRoundsPerSide * 2, false);
  if (fk.error) errors.firstKills = fk.error;
  if (fd.error) errors.firstDeaths = fd.error;
  if (fk.value != null && fd.value != null && total > 0 && fk.value + fd.value > total) {
    errors.firstDeaths = `First kills + first deaths can’t exceed the total rounds (${total}).`;
  }
  if (v.note.length > L.noteMaxLength) errors.note = `Note can be at most ${L.noteMaxLength} characters.`;
  if (v.time && !/^\d{2}:\d{2}$/.test(v.time)) errors.time = 'Time must look like HH:MM.';

  if (Object.keys(errors).length > 0) return { errors, input: null };
  const input: ManualMatchInput = {
    date: v.time ? `${v.date}T${v.time}:00Z` : v.date,
    mapId: v.mapId,
    agentId: v.agentId,
    queueId: v.queueId as ManualMatchInput['queueId'],
    roundsWon: rw.value as number,
    roundsLost: rl.value as number,
    kills: k.value as number,
    deaths: d.value as number,
    assists: a.value as number,
    ...(v.patch.trim() ? { patch: v.patch.trim() } : {}),
    ...(acs.value != null ? { acs: acs.value } : {}),
    ...(adr.value != null ? { adr: adr.value } : {}),
    ...(fk.value != null ? { firstKills: fk.value } : {}),
    ...(fd.value != null ? { firstDeaths: fd.value } : {}),
    ...(v.note.trim() ? { note: v.note.trim() } : {}),
  };
  return { errors, input };
}

export function derivedResult(rw: string, rl: string): string | null {
  if (!WHOLE.test(rw.trim()) || !WHOLE.test(rl.trim())) return null;
  const w = Number(rw);
  const l = Number(rl);
  if (w + l < 1) return null;
  return `${w > l ? 'Win' : w < l ? 'Loss' : 'Draw'} ${w}–${l}`;
}

function Field({
  id, label, error, hint, children,
}: { id: string; label: string; error?: string; hint?: string; children: (aria: Record<string, string | boolean | undefined>) => ReactNode }) {
  const describedBy = [error ? `${id}-err` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && (
        <span id={`${id}-hint`} className="small">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-err`} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

function FormBody({
  catalog, initial, editId,
}: {
  catalog: { agents: { id: string; name: string }[]; maps: { id: string; name: string }[] };
  initial?: ManualMatchDto;
  editId?: string;
}) {
  const navigate = useNavigate();
  const [v, setV] = useState<FormValues>(() => (initial ? valuesFromDto(initial) : emptyValues()));
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof FormValues) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [k]: e.target.value }));
  const result = useMemo(() => derivedResult(v.roundsWon, v.roundsLost), [v.roundsWon, v.roundsLost]);
  const empty = catalog.maps.length === 0 || catalog.agents.length === 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const { errors: errs, input } = validate(v);
    setErrors(errs);
    if (!input) return;
    setBusy(true);
    try {
      const saved = editId ? await updateManualMatch(editId, input) : await createManualMatch(input);
      navigate(`/matches/${encodeURIComponent(saved.id)}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) setServerError('An identical entry already exists.');
      else setServerError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  const errorList = Object.entries(errors);
  return (
    <form className="manual-form" onSubmit={submit} noValidate aria-label={editId ? 'Edit match' : 'Add match'}>
      {empty && (
        <p className="notice" role="status">
          Game content (maps and agents) hasn’t loaded yet, so the pickers are empty. Try again later.
        </p>
      )}
      {(serverError || errorList.length > 0) && (
        <div className="error-summary" role="alert">
          {serverError && <p>{serverError}</p>}
          {errorList.length > 0 && <p>Please fix {errorList.length === 1 ? 'the highlighted field' : 'the highlighted fields'}.</p>}
        </div>
      )}
      <p className="small">This match will be saved as a manual entry and labelled “Manual” everywhere. It is not Riot data.</p>

      <fieldset>
        <legend>Match</legend>
        <div className="form-grid">
          <Field id="mm-map" label="Map" error={errors.mapId}>
            {(a) => (
              <select {...a} value={v.mapId} onChange={set('mapId')}>
                <option value="">Choose a map</option>
                {catalog.maps.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            )}
          </Field>
          <Field id="mm-agent" label="Agent" error={errors.agentId}>
            {(a) => (
              <select {...a} value={v.agentId} onChange={set('agentId')}>
                <option value="">Choose an agent</option>
                {catalog.agents.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            )}
          </Field>
          <Field id="mm-queue" label="Queue" error={errors.queueId}>
            {(a) => (
              <select {...a} value={v.queueId} onChange={set('queueId')}>
                {MANUAL_QUEUES.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            )}
          </Field>
          <Field id="mm-date" label="Date" error={errors.date}>
            {(a) => (
              <input {...a} type="date" value={v.date} min={MANUAL_LIMITS.minDate} max={todayLocal()} onChange={set('date')} />
            )}
          </Field>
          <Field id="mm-time" label="Time (optional, UTC)" error={errors.time}>
            {(a) => <input {...a} type="time" value={v.time} onChange={set('time')} />}
          </Field>
          <Field id="mm-patch" label="Patch (optional)" error={errors.patch} hint="e.g. 9.08">
            {(a) => <input {...a} type="text" maxLength={20} value={v.patch} onChange={set('patch')} />}
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>Result and your stats</legend>
        <div className="form-grid">
          {(
            [
              ['roundsWon', 'Rounds won'],
              ['roundsLost', 'Rounds lost'],
              ['kills', 'Kills'],
              ['deaths', 'Deaths'],
              ['assists', 'Assists'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} id={`mm-${k}`} label={label} error={errors[k]}>
              {(a) => <input {...a} type="text" inputMode="numeric" value={v[k]} onChange={set(k)} />}
            </Field>
          ))}
        </div>
        <p className="result-line" aria-live="polite" data-testid="derived-result">
          {result ? `Result: ${result}` : 'Result: enter rounds won and lost'}
        </p>
      </fieldset>

      <fieldset>
        <legend>Optional stats</legend>
        <p className="small">Leave blank if you don’t know — blanks are treated as unavailable, not zero.</p>
        <div className="form-grid">
          {(
            [
              ['acs', 'ACS'],
              ['adr', 'ADR'],
              ['firstKills', 'First kills'],
              ['firstDeaths', 'First deaths'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} id={`mm-${k}`} label={label} error={errors[k]}>
              {(a) => <input {...a} type="text" inputMode="numeric" value={v[k]} onChange={set(k)} />}
            </Field>
          ))}
        </div>
        <div className="form-grid">
          <Field
            id="mm-note"
            label="Note"
            error={errors.note}
            hint={`${v.note.length}/${MANUAL_LIMITS.noteMaxLength} characters`}
          >
            {(a) => <textarea {...a} rows={3} maxLength={MANUAL_LIMITS.noteMaxLength} value={v.note} onChange={set('note')} />}
          </Field>
        </div>
      </fieldset>

      <div className="actions">
        <button type="submit" disabled={busy}>
          {editId ? 'Save changes' : 'Add match'}
        </button>
        <button type="button" className="secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Create/edit form. Pass `initial` + `editId` to edit an existing entry. */
export function ManualMatchForm({ initial, editId }: { initial?: ManualMatchDto; editId?: string }) {
  const opts = useApi(getFilterOptions, []);
  return <Query state={opts}>{(o) => <FormBody catalog={o.catalog} initial={initial} editId={editId} />}</Query>;
}
