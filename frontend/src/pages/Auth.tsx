import { useState } from 'react'
import { useLogin, useRegister } from '../hooks'
import { useStore } from '../store'

const T = {
  bg: '#F7F5F0',
  surface: '#FFFFFF',
  border: '#E2DDD5',
  text: '#1A1714',
  textSub: '#6B6560',
  textHint: '#A09990',
  accent: '#2D6A4F',
  accentLight: '#E8F4EE',
  red: '#DC2626',
  redLight: '#FEE2E2',
}

// ── Login ─────────────────────────────────────────────────────────────────────

export function LoginPage({ onSwitch }: { onSwitch: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const login = useLogin()
  const { showToast } = useStore()

  const handleSubmit = async () => {
    if (!email || !password) { showToast('נא למלא את כל השדות'); return }
    login.mutate({ email, password })
  }

  return (
    <AuthShell>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 48, marginBottom: 10 }}>🛒</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, margin: 0 }}>קניות ביחד</h1>
        <p style={{ fontSize: 14, color: T.textSub, marginTop: 6 }}>כניסה לחשבון</p>
      </div>

      <Field label="אימייל">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          dir="ltr"
          style={inputStyle}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
      </Field>

      <Field label="סיסמה">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="לפחות 8 תווים"
          dir="ltr"
          style={inputStyle}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
      </Field>

      <button
        onClick={handleSubmit}
        disabled={login.isLoading}
        style={primaryBtn}
      >
        {login.isLoading ? 'נכנס...' : 'כניסה'}
      </button>

      {login.isError && (
        <div style={{ background: T.redLight, color: T.red, borderRadius: 10, padding: '10px 14px', fontSize: 13, marginTop: 12 }}>
          {(login.error as Error).message}
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 13, color: T.textSub, marginTop: 20 }}>
        אין לך חשבון?{' '}
        <button onClick={onSwitch} style={{ background: 'none', border: 'none', color: T.accent, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
          הרשמה
        </button>
      </p>
    </AuthShell>
  )
}

// ── Register ──────────────────────────────────────────────────────────────────

export function RegisterPage({ onSwitch }: { onSwitch: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [gender, setGender] = useState<'m' | 'f'>('m')
  const register = useRegister()
  const { showToast } = useStore()

  const handleSubmit = async () => {
    if (!name || !email || !password) { showToast('נא למלא את כל השדות'); return }
    if (password.length < 8) { showToast('הסיסמה חייבת להיות לפחות 8 תווים'); return }
    register.mutate({ name, email, password, grammatical_gender: gender })
  }

  return (
    <AuthShell>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 48, marginBottom: 10 }}>🛒</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, margin: 0 }}>הצטרפות</h1>
        <p style={{ fontSize: 14, color: T.textSub, marginTop: 6 }}>צור חשבון חדש</p>
      </div>

      <Field label="שם מלא">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ישראל ישראלי"
          dir="rtl"
          style={inputStyle}
        />
      </Field>

      <Field label="אימייל">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          dir="ltr"
          style={inputStyle}
        />
      </Field>

      <Field label="סיסמה">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="לפחות 8 תווים"
          dir="ltr"
          style={inputStyle}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
      </Field>

      <Field label="פנייה">
        <div style={{ display: 'flex', gap: 8 }}>
          {(['m', 'f'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGender(g)}
              style={{
                flex: 1, padding: '10px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 13,
                background: gender === g ? T.accent : '#F0EDE6',
                color: gender === g ? '#fff' : T.text,
                fontWeight: gender === g ? 600 : 400,
                transition: 'all 0.15s',
              }}
            >
              {g === 'm' ? 'זכר' : 'נקבה'}
            </button>
          ))}
        </div>
      </Field>

      <button
        onClick={handleSubmit}
        disabled={register.isLoading}
        style={primaryBtn}
      >
        {register.isLoading ? 'נרשם...' : 'יצירת חשבון'}
      </button>

      {register.isError && (
        <div style={{ background: T.redLight, color: T.red, borderRadius: 10, padding: '10px 14px', fontSize: 13, marginTop: 12 }}>
          {(register.error as Error).message}
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 13, color: T.textSub, marginTop: 20 }}>
        כבר יש לך חשבון?{' '}
        <button onClick={onSwitch} style={{ background: 'none', border: 'none', color: T.accent, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
          כניסה
        </button>
      </p>
    </AuthShell>
  )
}

// ── Shared components ─────────────────────────────────────────────────────────

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh', background: T.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px 16px', fontFamily: "'Heebo', 'Assistant', sans-serif",
      }}
    >
      <div style={{
        background: T.surface, borderRadius: 20, padding: '32px 24px',
        width: '100%', maxWidth: 380,
        border: `1px solid ${T.border}`,
      }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B6560', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: '11px 14px',
  fontSize: 15,
  color: T.text,
  background: '#F7F5F0',
  outline: 'none',
  boxSizing: 'border-box',
}

const primaryBtn: React.CSSProperties = {
  width: '100%',
  padding: '14px',
  fontSize: 15,
  fontWeight: 700,
  background: T.accent,
  color: '#fff',
  border: 'none',
  borderRadius: 14,
  cursor: 'pointer',
  marginTop: 8,
  fontFamily: 'inherit',
}
