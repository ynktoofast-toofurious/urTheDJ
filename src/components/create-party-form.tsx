'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createParty } from '@/lib/api';

export function CreatePartyForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [form, setForm] = useState({ partyName: '', createdBy: '', partyStyle: '' });

  function updateField(name: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    startTransition(async () => {
      try {
        const result = await createParty({
          partyName: form.partyName,
          createdBy: form.createdBy,
          partyStyle: form.partyStyle
        });

        router.push(`/admin/party/${result.sessionId}`);
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : 'Unable to create party.');
      }
    });
  }

  return (
    <form className="panel stack" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="partyName">Party name</label>
        <input
          id="partyName"
          value={form.partyName}
          onChange={(event) => updateField('partyName', event.target.value)}
          placeholder="Saturday Night Rooftop"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="createdBy">Created by</label>
        <input
          id="createdBy"
          value={form.createdBy}
          onChange={(event) => updateField('createdBy', event.target.value)}
          placeholder="DJ Nova"
        />
      </div>
      <div className="field">
        <label htmlFor="partyStyle">Party style</label>
        <input
          id="partyStyle"
          value={form.partyStyle}
          onChange={(event) => updateField('partyStyle', event.target.value)}
          placeholder="Hip-hop to open, EDM peak hour, disco close"
        />
      </div>
      {error ? <p className="helper" style={{ color: 'var(--danger)' }}>{error}</p> : null}
      <button className="btn full-width" disabled={isPending} type="submit">
        {isPending ? 'Creating party...' : 'Create Party'}
      </button>
    </form>
  );
}
