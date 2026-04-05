import { useState } from 'react'
import { useCreateHousehold, useHouseholds } from '../hooks'

const EMOJIS = ['🏠', '🏡', '🏘️', '🌻', '⭐', '🎯', '🍀', '🌈']

const T = {
  bg: '#F7F5F0', surface: '#FFFFFF', border: '#E2DDD5',
  text: '#1A1714', textSub: '#6B6560',
  accent: '#2D6A4F', accentLight: '#E8F4EE',
}

export function HouseholdSetupPage() {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🏠')
  const create = useCreateHousehold()
  const { refetch } = useHouseholds()

  const handleCreate = async () => {
    if (!name.trim()) return
    await create.mutateAsync({ name: name.trim(), emoji })
    refetch()
  }

  return (
    <div dir="rtl" style={{
      minHeight: '100vh', background: T.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, fontFamily: "'Heebo', 'Assistant', sans-serif",
    }}>
      <div style={{ background: T.surface, borderRadius: 20, padding: '32px 24px', width: '100%', maxWidth: 380, border: `1px solid ${T.border}` }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 52, marginBottom: 10 }}>{emoji}</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: 0 }}>יצירת משק בית</h2>
          <p style={{ fontSize: 14, color: T.textSub, marginTop: 6 }}>הזמן את המשפחה לאחר היצירה</p>
        </div>

        {/* Emoji picker */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.textSub, marginBottom: 8 }}>אייקון</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                style={{
                  width: 44, height: 44, borderRadius: 12, border: 'none', fontSize: 22, cursor: 'pointer',
                  background: emoji === e ? T.accentLight : '#F0EDE6',
                  outline: emoji === e ? `2px solid ${T.accent}` : 'none',
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.textSub, marginBottom: 8 }}>שם משק הבית</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="למשל: משפחת כהן"
            dir="rtl"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 12, padding: '11px 14px', fontSize: 15, color: T.text, background: '#F7F5F0', outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' }}
          />
        </div>

        <button
          onClick={handleCreate}
          disabled={!name.trim() || create.isLoading}
          style={{
            width: '100%', padding: 14, fontSize: 15, fontWeight: 700,
            background: name.trim() ? T.accent : '#C8C2B8',
            color: '#fff', border: 'none', borderRadius: 14, cursor: name.trim() ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}
        >
          {create.isLoading ? 'יוצר...' : `צור את ${emoji} ${name || 'משק הבית'}`}
        </button>
      </div>
    </div>
  )
}
