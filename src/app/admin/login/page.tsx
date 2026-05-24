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
      const dest = searchParams.get('from') ?? '/admin';
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
      <div className="pin-row">
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
            className="pin-cell"
          />
        ))}
      </div>

      {error && <p className="pin-error">{error}</p>}
      {loading && <p className="subtle">Checking…</p>}
    </>
  );
}

export default function AdminLoginPage() {
  return (
    <main className="login-page">
      <section className="login-title">
        <p className="eyebrow">DJ Access</p>
        <h1>Enter your PIN</h1>
        <p className="subtle">4-digit admin PIN required to manage the party.</p>
      </section>

      <Suspense fallback={<div className="pin-row">{[0,1,2,3].map(i => <div key={i} className="pin-cell" style={{ pointerEvents: 'none' }} />)}</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
