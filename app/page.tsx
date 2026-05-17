import { auth, signIn } from '@/auth';
import { redirect } from 'next/navigation';

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo-name" style={{ fontSize: 28, marginBottom: 6 }}>
          Market Pulse
        </div>
        <div className="logo-sub" style={{ marginBottom: 36 }}>
          Live stock tracker + smart alerts
        </div>

        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/dashboard' });
          }}
        >
          <button type="submit" className="google-btn">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13 17.8 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.6 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 6.9-10 6.9-17z"/>
              <path fill="#FBBC05" d="M10.6 28.5A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.1.7-4.5l-7.9-6.1A23.9 23.9 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.2z"/>
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.2 1.5-5 2.3-8.4 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/>
            </svg>
            Sign in with Google
          </button>
        </form>

        <p className="login-note">
          Your watchlist and alert settings are private to your account.
        </p>
      </div>
    </div>
  );
}
