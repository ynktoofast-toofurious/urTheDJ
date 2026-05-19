'use client';

import { Suspense, useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  const handleChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...pin];
    next[index] = value;
    setPin(next);
    if (value && index < 3) {
      inputs.current[index + 1]?.focus();
    }
    if (next.every(d => d !== '')) {
      void submit(next.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const submit = async (code: string) => {
    setLoading(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: code }),
    });
    if (res.ok) {
      const dest = searchParams.get('from') ?? '/admin/create-party';
      router.replace(dest);
    } else {
      setError('Wrong PIN — try again');
      setPin(['', '', '', '']);
      setLoading(false);
      setTimeout(() => inputs.current[0]?.focus(), 50);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        {pin.map((digit, i) => (
          <input
            key={i}
            ref={el => { inputs.current[i] = el; }}
            type="password"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            disabled={loading}
            style={{
              width: '3.5rem',
              height: '3.5rem',
              fontSize: '1.5rem',
              textAlign: 'center',
              border: '2px solid var(--border)',
              borderRadius: '0.75rem',
              background: 'var(--surface)',
              color: 'var(--text)',
              outline: 'none',
            }}
          />
        ))}
      </div>

      {error && (
        <p style={{ color: 'var(--accent-red, #f87171)', fontWeight: 600 }}>{error}</p>
      )}

      {loading && <p style={{ color: 'var(--text-muted)' }}>Checking…</p>}
    </>
  );
}

export default function AdminLoginPage() {
  return (
    <main className="app-frame" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: '2rem' }}>
      <section style={{ textAlign: 'center' }}>
        <p className="eyebrow">DJ Access</p>
        <h1>Enter your PIN</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>4-digit admin PIN required to manage the party.</p>
      </section>

      <Suspense fallback={<div style={{ display: 'flex', gap: '0.75rem' }}>{[0,1,2,3].map(i => <div key={i} style={{ width: '3.5rem', height: '3.5rem', borderRadius: '0.75rem', background: 'var(--surface)', border: '2px solid var(--border)' }} />)}</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
