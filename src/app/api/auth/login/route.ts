import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  const body = (await request.json()) as { pin?: string };
  const adminPin = (process.env.ADMIN_PIN ?? '0000').trim();

  if (!body.pin || body.pin !== adminPin) {
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set('dj_auth', '1', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12, // 12 hours
  });

  return NextResponse.json({ ok: true });
}
