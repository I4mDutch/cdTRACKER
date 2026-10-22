import { useEffect, useState } from 'react';
import type { MatchFilter } from '@va/shared';
import { getFilterOptions } from '../api/client';
import { useApi } from '../api/useApi';
import { useFilter } from '../filters';

export function FilterBar() {
  const { filter, setFilter } = useFilter();
  const opts = useApi(getFilterOptions, []);
  const [draft, setDraft] = useState<MatchFilter>(filter);
  useEffect(() => setDraft(filter), [filter]);

  const o = opts.data;
  const set = (patch: Partial<MatchFilter>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    return next;
  };
  const apply = (patch: Partial<MatchFilter>) => setFilter(set(patch));

  return (
    <form
      className="filter-bar"
      aria-label="Filters"
      onSubmit={(e) => {
        e.preventDefault();
        setFilter(draft);
      }}
    >
      <label>
        Agent
        <select value={draft.agentId ?? ''} onChange={(e) => apply({ agentId: e.target.value || undefined })}>
          <option value="">All agents</option>
          {o?.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Map
        <select value={draft.mapId ?? ''} onChange={(e) => apply({ mapId: e.target.value || undefined })}>
          <option value="">All maps</option>
          {o?.maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Queue
        <select value={draft.queueId ?? ''} onChange={(e) => apply({ queueId: e.target.value || undefined })}>
          <option value="">Default (competitive)</option>
          {o?.queues.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </label>
      <label>
        Patch
        <select value={draft.patch ?? ''} onChange={(e) => apply({ patch: e.target.value || undefined })}>
          <option value="">All patches</option>
          {o?.patches.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label>
        From
        <input type="date" value={draft.from ?? ''} onChange={(e) => apply({ from: e.target.value || undefined })} />
      </label>
      <label>
        To
        <input type="date" value={draft.to ?? ''} onChange={(e) => apply({ to: e.target.value || undefined })} />
      </label>
      <label>
        Last N matches
        <input
          type="number"
          min={1}
          inputMode="numeric"
          value={draft.lastN ?? ''}
          onChange={(e) => set({ lastN: e.target.value ? Number(e.target.value) : undefined })}
          onBlur={() => setFilter(draft)}
        />
      </label>
      <button type="button" className="secondary" onClick={() => setFilter({})}>
        Clear filters
      </button>
    </form>
  );
}
