import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore, selectActiveItems, selectPendingItems } from './store'
import {
  useHouseholds, useLists, useListItems, useCategories,
  useCatalogSearch, useAddItem, useToggleItem, useDeleteItem,
  useCreateCatalogItem, useRecurring, useCreateRecurring,
  useUpdateRecurring, useListWebSocket, useOfflineSync,
} from './hooks'
import { LoginPage, RegisterPage } from './pages/Auth'
import { HouseholdSetupPage } from './pages/HouseholdSetup'
import type { CatalogItem, ListItem, Screen } from './types'

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg: '#F7F5F0', surface: '#FFFFFF', surfaceAlt: '#F0EDE6',
  border: '#E2DDD5', borderStrong: '#C8C2B8',
  text: '#1A1714', textSub: '#6B6560', textHint: '#A09990',
  accent: '#2D6A4F', accentLight: '#E8F4EE', accentText: '#1B4332',
  amber: '#D97706', amberLight: '#FEF3C7', amberText: '#92400E',
  red: '#DC2626', redLight: '#FEE2E2',
  purchased: '#9CA3AF',
}

const FREQ_LABELS: Record<string, string> = {
  daily: 'יומי', weekly: 'שבועי', biweekly: 'כל שבועיים', monthly: 'חודשי', custom: 'מותאם',
}

function daysUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / 86400000))
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const { isAuthenticated, user, logout } = useStore()
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')

  // Auth guard
  if (!isAuthenticated) {
    return authMode === 'login'
      ? <LoginPage onSwitch={() => setAuthMode('register')} />
      : <RegisterPage onSwitch={() => setAuthMode('login')} />
  }

  return <AuthenticatedApp />
}

// ── Authenticated shell ───────────────────────────────────────────────────────
function AuthenticatedApp() {
  const { activeHouseholdId, activeListId, households, setActiveList } = useStore()
  const [screen, setScreen] = useState<Screen>('list')
  const [showAddSheet, setShowAddSheet] = useState(false)
  const [showItemSheet, setShowItemSheet] = useState<CatalogItem | null>(null)

  // Data fetching
  useHouseholds()
  const { data: lists = [] } = useLists(activeHouseholdId ?? undefined)
  useListItems(activeListId ?? '')
  const { data: recurringData = [] } = useRecurring(activeHouseholdId ?? '')

  // Offline sync + WebSocket
  useOfflineSync(activeListId ?? '')
  useListWebSocket(activeListId ?? '')

  const { toast, clearToast, showToast, isOffline } = useStore()
  const activeList = lists.find((l: any) => l.id === activeListId)
  const items = useStore(selectActiveItems)
  const toggleItem = useToggleItem(activeListId ?? '')
  const deleteItem = useDeleteItem(activeListId ?? '')
  const addItem = useAddItem(activeListId ?? '')

  // Household not set up yet
  if (!activeHouseholdId && households.length === 0) {
    return <HouseholdSetupPage />
  }

  const pendingCount = items.filter((i) => i.status === 'pending').length
  const suggestions = (recurringData as any[]).filter(
    (r) => r.is_enabled && !r.auto_add && daysUntil(r.next_run_date) <= 2
  )

  const handleAddItem = (catalogItem: CatalogItem, qty: number, unit: string, note: string) => {
    addItem.mutate({ catalog_item_id: catalogItem.id, quantity: qty, unit, note })
    setShowItemSheet(null)
    showToast(`נוסף: ${catalogItem.name_he}`)
  }

  return (
    <div dir="rtl" style={{ fontFamily: "'Heebo', 'Assistant', sans-serif", background: T.bg, minHeight: '100vh', maxWidth: 430, margin: '0 auto', position: 'relative' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        ::-webkit-scrollbar { display: none; }
        button { cursor: pointer; font-family: inherit; }
        input, select { font-family: inherit; }
        .row-tap { transition: opacity 0.15s; }
        .row-tap:active { opacity: 0.7; }
        .sheet-up { animation: sheetUp 0.3s cubic-bezier(0.32,0.72,0,1); }
        @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.2s ease; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {isOffline && (
        <div style={{ background: T.amber, color: '#fff', textAlign: 'center', fontSize: 12, padding: '6px', fontWeight: 500 }}>
          מצב לא מקוון — שינויים ישמרו ויסונכרנו
        </div>
      )}

      <Header
        screen={screen} setScreen={setScreen}
        lists={lists} activeListId={activeListId ?? ''}
        setActiveList={setActiveList}
        pendingCount={pendingCount} totalCount={items.length}
        suggestionCount={suggestions.length}
      />

      <div style={{ paddingBottom: 100 }}>
        {screen === 'list' && (
          <ListScreen
            items={items}
            suggestions={suggestions}
            onToggle={(id: string) => toggleItem.mutate({ itemId: id, status: items.find(i => i.id === id)?.status === 'pending' ? 'purchased' : 'pending' })}
            onDelete={(id: string) => deleteItem.mutate(id)}
            onAddSuggestion={(r: any) => {
              addItem.mutate({ catalog_item_id: r.catalog_item_id, quantity: r.quantity, unit: r.unit })
              showToast(`נוסף: ${r.catalog_item?.name_he}`)
            }}
          />
        )}
        {screen === 'shopping' && (
          <ShoppingMode items={items}
            onToggle={(id: string) => toggleItem.mutate({ itemId: id, status: items.find(i => i.id === id)?.status === 'pending' ? 'purchased' : 'pending' })}
          />
        )}
        {screen === 'recurring' && (
          <RecurringScreen householdId={activeHouseholdId ?? ''} recurringData={recurringData as any[]} />
        )}
        {screen === 'catalog' && <CatalogScreen />}
      </div>

      {screen === 'list' && (
        <button
          onClick={() => setShowAddSheet(true)}
          style={{
            position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
            background: T.accent, color: '#fff', border: 'none',
            borderRadius: 20, padding: '14px 32px', fontSize: 15, fontWeight: 700,
            boxShadow: '0 4px 20px rgba(45,106,79,0.35)', zIndex: 50,
            transition: 'transform 0.15s', display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <span style={{ fontSize: 20 }}>+</span> הוסף פריט
        </button>
      )}

      <BottomNav screen={screen} setScreen={setScreen} badgeCount={suggestions.length} />

      {showAddSheet && (
        <AddItemSheet
          activeListId={activeListId ?? ''}
          onClose={() => setShowAddSheet(false)}
          onSelect={(cat) => { setShowItemSheet(cat); setShowAddSheet(false) }}
        />
      )}

      {showItemSheet && (
        <ItemDetailSheet
          item={showItemSheet}
          onClose={() => setShowItemSheet(null)}
          onAdd={handleAddItem}
        />
      )}

      {toast && <Toast msg={toast.msg} action={toast.action} onDismiss={clearToast} />}
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ screen, setScreen, lists, activeListId, setActiveList, pendingCount, totalCount, suggestionCount }: any) {
  const { logout } = useStore()
  if (screen !== 'list') {
    const titles: Record<string, string> = { shopping: 'מצב קנייה', recurring: 'פריטים קבועים', catalog: 'קטלוג' }
    return (
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setScreen('list')} style={{ background: 'none', border: 'none', color: T.textSub, fontSize: 22, padding: 0 }}>←</button>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{titles[screen]}</div>
        </div>
      </div>
    )
  }
  const activeList = lists.find((l: any) => l.id === activeListId)
  return (
    <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, zIndex: 40 }}>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{activeList?.emoji} {activeList?.name}</div>
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
              {pendingCount} נשארו מתוך {totalCount}
              {suggestionCount > 0 && (
                <span style={{ background: T.amberLight, color: T.amberText, padding: '1px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                  {suggestionCount} הצעות
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setScreen('shopping')} style={{ background: T.accentLight, color: T.accentText, border: 'none', borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 600 }}>
              קנייה
            </button>
            <button onClick={logout} style={{ background: T.surfaceAlt, border: 'none', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: T.textSub }}>יציאה</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto' as const }}>
          {lists.map((l: any) => (
            <button key={l.id} onClick={() => setActiveList(l.id)}
              style={{ background: l.id === activeListId ? T.accent : T.surfaceAlt, color: l.id === activeListId ? '#fff' : T.textSub, border: 'none', borderRadius: 20, padding: '5px 14px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' as const, flexShrink: 0 }}>
              {l.emoji} {l.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── List Screen ───────────────────────────────────────────────────────────────
function ListScreen({ items, suggestions, onToggle, onDelete, onAddSuggestion }: any) {
  const { data: categories = [] } = useCategories()
  const catMap = Object.fromEntries((categories as any[]).map((c: any) => [c.id, c]))
  const [showSugg, setShowSugg] = useState(true)

  // Group by category
  const byCat: Record<string, ListItem[]> = {}
  items.forEach((item: ListItem) => {
    const cid = item.catalog_item?.category_id ?? 'other'
    if (!byCat[cid]) byCat[cid] = []
    byCat[cid].push(item)
  })

  const pendingSugg = suggestions.filter(
    (r: any) => !items.find((i: ListItem) => i.catalog_item_id === r.catalog_item_id && i.status === 'pending')
  )

  if (items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: T.textHint }}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>🛒</div>
        <div style={{ fontSize: 16, fontWeight: 500 }}>הרשימה ריקה</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>לחץ + להוספת פריט</div>
      </div>
    )
  }

  return (
    <div>
      {pendingSugg.length > 0 && showSugg && (
        <div className="fade-in" style={{ margin: '12px 16px', background: T.amberLight, borderRadius: 14, border: `1px solid #FCD34D`, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.amberText }}>הצעות להוספה</div>
            <button onClick={() => setShowSugg(false)} style={{ background: 'none', border: 'none', color: T.amberText, fontSize: 18 }}>×</button>
          </div>
          {pendingSugg.map((r: any) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 14px', gap: 10, borderTop: `1px solid #FCD34D` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.amberText }}>{r.catalog_item?.name_he}</div>
                <div style={{ fontSize: 11, color: T.amber }}>{FREQ_LABELS[r.frequency]} · בעוד {daysUntil(r.next_run_date)} יום</div>
              </div>
              <button onClick={() => onAddSuggestion(r)} style={{ background: T.amber, border: 'none', color: '#fff', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700 }}>הוסף</button>
            </div>
          ))}
        </div>
      )}

      {Object.entries(byCat).map(([catId, catItems]) => {
        const cat = catMap[catId] as any
        const pending = catItems.filter((i) => i.status === 'pending')
        const purchased = catItems.filter((i) => i.status === 'purchased')
        return (
          <div key={catId}>
            {pending.length > 0 && (
              <>
                <div style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 700, color: T.textSub, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{cat?.icon}</span> {cat?.name_he}
                </div>
                {pending.map((item) => <ItemRow key={item.id} item={item} onToggle={onToggle} onDelete={onDelete} />)}
              </>
            )}
            {purchased.map((item) => <ItemRow key={item.id} item={item} onToggle={onToggle} onDelete={onDelete} purchased />)}
          </div>
        )
      })}
    </div>
  )
}

// ── Item Row ──────────────────────────────────────────────────────────────────
function ItemRow({ item, onToggle, onDelete, purchased }: { item: ListItem; onToggle: (id: string) => void; onDelete: (id: string) => void; purchased?: boolean }) {
  const [showMenu, setShowMenu] = useState(false)
  const pressTimer = useRef<ReturnType<typeof setTimeout>>()
  const cat = item.catalog_item

  return (
    <>
      <div
        className="row-tap"
        onMouseDown={() => { pressTimer.current = setTimeout(() => setShowMenu(true), 420) }}
        onMouseUp={() => clearTimeout(pressTimer.current)}
        onTouchStart={() => { pressTimer.current = setTimeout(() => setShowMenu(true), 420) }}
        onTouchEnd={() => clearTimeout(pressTimer.current)}
        style={{ display: 'flex', alignItems: 'center', padding: '13px 16px', gap: 12, background: T.surface, borderBottom: `1px solid ${T.border}`, opacity: purchased ? 0.55 : 1, minHeight: 58 }}
      >
        <div onClick={() => onToggle(item.id)}
          style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, border: purchased ? `2px solid ${T.accent}` : `2px solid ${T.borderStrong}`, background: purchased ? T.accentLight : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s' }}>
          {purchased && <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
        <div onClick={() => onToggle(item.id)} style={{ flex: 1, cursor: 'pointer', userSelect: 'none' as const }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: purchased ? T.purchased : T.text, textDecoration: purchased ? 'line-through' : 'none' }}>
            {cat?.name_he}
          </div>
          <div style={{ fontSize: 12, color: T.textSub }}>
            {item.quantity} {item.unit}{item.note ? ` · ${item.note}` : ''}
          </div>
        </div>
      </div>

      {showMenu && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end' }} onClick={() => setShowMenu(false)}>
          <div className="sheet-up" onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: '20px 20px 0 0', width: '100%', padding: '8px 0 28px' }}>
            <div style={{ padding: '12px 20px', borderBottom: `1px solid ${T.border}`, fontSize: 16, fontWeight: 600 }}>{cat?.name_he}</div>
            {[
              { label: purchased ? 'סמן כממתין' : 'סמן כנקנה', icon: '✓', action: () => { onToggle(item.id); setShowMenu(false) } },
              { label: 'מחק פריט', icon: '🗑', danger: true, action: () => { onDelete(item.id); setShowMenu(false) } },
            ].map((opt) => (
              <div key={opt.label} onClick={opt.action}
                style={{ padding: '14px 20px', display: 'flex', gap: 14, alignItems: 'center', cursor: 'pointer', color: opt.danger ? T.red : T.text, fontSize: 15 }}>
                <span style={{ fontSize: 18 }}>{opt.icon}</span> {opt.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ── Shopping Mode ─────────────────────────────────────────────────────────────
function ShoppingMode({ items, onToggle }: { items: ListItem[]; onToggle: (id: string) => void }) {
  const { data: categories = [] } = useCategories()
  const catMap = Object.fromEntries((categories as any[]).map((c: any) => [c.id, c]))
  const byCat: Record<string, ListItem[]> = {}
  items.forEach((i) => { const c = i.catalog_item?.category_id ?? 'other'; if (!byCat[c]) byCat[c] = []; byCat[c].push(i) })

  const done = items.filter(i => i.status === 'purchased').length
  const pct = items.length ? Math.round(done / items.length * 100) : 0

  return (
    <div>
      <div style={{ background: T.surface, padding: '14px 16px', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, color: T.textSub }}>
          <span>התקדמות</span>
          <span style={{ fontWeight: 700, color: pct === 100 ? T.accent : T.text }}>{pct}%</span>
        </div>
        <div style={{ background: T.surfaceAlt, borderRadius: 10, height: 8, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? T.accent : T.amber, borderRadius: 10, transition: 'width 0.4s' }} />
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: T.textSub }}>{done} מתוך {items.length} נקנו</div>
      </div>

      {Object.entries(byCat).map(([catId, catItems]) => {
        const cat = catMap[catId] as any
        const pending = catItems.filter(i => i.status === 'pending')
        const purchased = catItems.filter(i => i.status === 'purchased')
        return (
          <div key={catId}>
            <div style={{ padding: '10px 16px 6px', fontSize: 11, fontWeight: 700, color: T.textSub, background: T.bg, position: 'sticky' as const, top: 57, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{cat?.icon}</span> {cat?.name_he?.toUpperCase()}
              <span style={{ marginRight: 'auto', fontWeight: 400, fontSize: 11 }}>{purchased.length}/{catItems.length}</span>
            </div>
            {[...pending, ...purchased].map((item) => (
              <div key={item.id} className="row-tap" onClick={() => onToggle(item.id)}
                style={{ display: 'flex', alignItems: 'center', padding: '16px', gap: 14, background: item.status === 'purchased' ? T.surfaceAlt : T.surface, borderBottom: `1px solid ${T.border}`, cursor: 'pointer', minHeight: 64 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, border: item.status === 'purchased' ? `2px solid ${T.accent}` : `2px solid ${T.borderStrong}`, background: item.status === 'purchased' ? T.accentLight : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.25s' }}>
                  {item.status === 'purchased' && <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 7l4 4 6-6" fill="none" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: item.status === 'purchased' ? 400 : 500, color: item.status === 'purchased' ? T.purchased : T.text, textDecoration: item.status === 'purchased' ? 'line-through' : 'none' }}>
                    {item.catalog_item?.name_he}
                  </div>
                  <div style={{ fontSize: 13, color: T.textSub }}>{item.quantity} {item.unit}{item.note ? ` · ${item.note}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── Add Item Sheet ────────────────────────────────────────────────────────────
function AddItemSheet({ activeListId, onClose, onSelect }: { activeListId: string; onClose: () => void; onSelect: (item: CatalogItem) => void }) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { data: cats = [] } = useCategories()
  const { data: results } = useCatalogSearch(q)
  const items = useStore(selectActiveItems)
  const recentIds = [...new Set(items.map(i => i.catalog_item_id))].slice(0, 5)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 120) }, [])

  const catalogItems = (results as any)?.items ?? []

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div className="sheet-up" onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: '20px 20px 0 0', width: '100%', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ width: 40, height: 4, background: T.border, borderRadius: 2, margin: '10px auto' }} />
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', background: T.surfaceAlt, borderRadius: 14, padding: '0 12px', border: `1px solid ${T.border}` }}>
            <span style={{ color: T.textHint, marginLeft: 8 }}>🔍</span>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="חפש פריט..." dir="rtl"
              style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 15, padding: '12px 4px', color: T.text, outline: 'none' }} />
            {q && <button onClick={() => setQ('')} style={{ background: 'none', border: 'none', color: T.textHint, fontSize: 18 }}>×</button>}
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!q && recentIds.length > 0 && (
            <div style={{ padding: '0 16px 12px' }}>
              <div style={{ fontSize: 11, color: T.textSub, fontWeight: 700, marginBottom: 8 }}>אחרונים</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                {recentIds.map((id) => {
                  const cat = items.find(i => i.catalog_item_id === id)?.catalog_item
                  if (!cat) return null
                  return (
                    <button key={id} onClick={() => onSelect(cat)}
                      style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 20, padding: '6px 12px', fontSize: 13, color: T.text }}>
                      {cat.name_he}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {catalogItems.map((c: CatalogItem) => (
            <div key={c.id} className="row-tap" onClick={() => onSelect(c)}
              style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, borderBottom: `1px solid ${T.border}`, cursor: 'pointer' }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: T.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                {c.image_url ? <img src={c.image_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : <span style={{ fontSize: 22 }}>📦</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{c.name_he}</div>
                <div style={{ fontSize: 12, color: T.textSub }}>{c.default_qty} {c.default_unit}</div>
              </div>
              <span style={{ color: T.textHint, fontSize: 22 }}>+</span>
            </div>
          ))}

          {q.length >= 2 && (
            <div className="row-tap" onClick={() => onSelect({ id: 'new', name_he: q, name_en: null, category_id: 'other', image_url: null, default_qty: 1, default_unit: 'יחידות', barcode: null, usage_count: 0 })}
              style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, cursor: 'pointer', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: T.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 2v12M2 8h12" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" /></svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.accentText }}>צור פריט חדש</div>
                <div style={{ fontSize: 12, color: T.textSub }}>"{q}"</div>
              </div>
            </div>
          )}

          {!q && (cats as any[]).length > 0 && (
            <div style={{ padding: '4px 16px 16px' }}>
              <div style={{ fontSize: 11, color: T.textSub, fontWeight: 700, marginBottom: 8 }}>קטגוריות</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(cats as any[]).map((cat) => (
                  <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 12, padding: '10px 12px' }}>
                    <span style={{ fontSize: 20 }}>{cat.icon}</span>
                    <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{cat.name_he}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Item Detail Sheet ─────────────────────────────────────────────────────────
function ItemDetailSheet({ item, onClose, onAdd }: { item: CatalogItem; onClose: () => void; onAdd: (item: CatalogItem, qty: number, unit: string, note: string) => void }) {
  const [qty, setQty] = useState(item.default_qty || 1)
  const [unit, setUnit] = useState(item.default_unit || 'יחידות')
  const [note, setNote] = useState('')
  const { data: categories = [] } = useCategories()
  const createCatalog = useCreateCatalogItem()
  const [catId, setCatId] = useState(item.category_id || 'other')
  const isNew = item.id === 'new'

  const handleAdd = async () => {
    let finalItem = item
    if (isNew) {
      const created = await createCatalog.mutateAsync({ name_he: item.name_he, category_id: catId, default_qty: qty, default_unit: unit }) as any
      finalItem = { ...item, id: created.id }
    }
    onAdd(finalItem, qty, unit, note)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div className="sheet-up" onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: '20px 20px 0 0', width: '100%', paddingBottom: 32 }}>
        <div style={{ width: 40, height: 4, background: T.border, borderRadius: 2, margin: '10px auto' }} />
        <div style={{ padding: '8px 16px 14px', display: 'flex', gap: 12, alignItems: 'center', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: T.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, overflow: 'hidden', flexShrink: 0 }}>
            {item.image_url ? <img src={item.image_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : '📦'}
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{item.name_he}</div>
            {isNew && <div style={{ fontSize: 12, color: T.accent, fontWeight: 600 }}>פריט חדש בקטלוג</div>}
          </div>
        </div>

        <div style={{ padding: '16px 16px 0' }}>
          {isNew && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: T.textSub, fontWeight: 700, marginBottom: 8 }}>קטגוריה</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                {(categories as any[]).map((cat) => (
                  <button key={cat.id} onClick={() => setCatId(cat.id)}
                    style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, border: 'none', background: catId === cat.id ? T.accent : T.surfaceAlt, color: catId === cat.id ? '#fff' : T.text }}>
                    {cat.icon} {cat.name_he}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: T.textSub, fontWeight: 700, marginBottom: 8 }}>כמות</div>
            <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden', background: T.surfaceAlt }}>
              <button onClick={() => setQty(Math.max(0.5, qty - 1))} style={{ padding: '14px 20px', fontSize: 22, background: 'none', border: 'none', color: T.text }}>−</button>
              <div style={{ flex: 1, textAlign: 'center', fontSize: 20, fontWeight: 700 }}>{qty}</div>
              <button onClick={() => setQty(qty + 1)} style={{ padding: '14px 20px', fontSize: 22, background: 'none', border: 'none', color: T.text }}>+</button>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: T.textSub, fontWeight: 700, marginBottom: 8 }}>יחידה</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
              {['יחידות', 'ק"ג', 'גרם', 'ליטר', 'צרור', 'שקית'].map((u) => (
                <button key={u} onClick={() => setUnit(u)}
                  style={{ padding: '6px 14px', borderRadius: 20, fontSize: 13, border: 'none', background: unit === u ? T.accent : T.surfaceAlt, color: unit === u ? '#fff' : T.text }}>
                  {u}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: T.textSub, fontWeight: 700, marginBottom: 8 }}>הערה</div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="אופציונלי..." dir="rtl"
              style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 12, padding: '10px 14px', fontSize: 14, background: T.surfaceAlt, outline: 'none', boxSizing: 'border-box' as const }} />
          </div>

          <button onClick={handleAdd}
            style={{ width: '100%', padding: 15, fontSize: 16, fontWeight: 700, background: T.accent, color: '#fff', border: 'none', borderRadius: 16, cursor: 'pointer' }}>
            הוסף לרשימה
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Recurring Screen ──────────────────────────────────────────────────────────
function RecurringScreen({ householdId, recurringData }: { householdId: string; recurringData: any[] }) {
  const update = useUpdateRecurring(householdId)
  const create = useCreateRecurring(householdId)
  const { data: cats = [] } = useCategories()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ catalog_item_id: '', frequency: 'weekly', auto_add: true })

  const toggle = (r: any) => update.mutate({ id: r.id, body: { is_enabled: !r.is_enabled } })
  const active = recurringData.filter(r => r.is_enabled)
  const paused = recurringData.filter(r => !r.is_enabled)

  return (
    <div style={{ padding: 16 }}>
      <Section title="עתידי">
        {active.length === 0 && <Empty text="אין פריטים קבועים פעילים" />}
        {active.sort((a, b) => daysUntil(a.next_run_date) - daysUntil(b.next_run_date)).map((r) => (
          <RecurringRow key={r.id} r={r} onToggle={toggle} />
        ))}
      </Section>

      {paused.length > 0 && (
        <Section title="מושהים">
          {paused.map((r) => <RecurringRow key={r.id} r={r} onToggle={toggle} paused />)}
        </Section>
      )}

      <button onClick={() => setShowCreate(true)}
        style={{ width: '100%', padding: 14, border: `1.5px dashed ${T.borderStrong}`, borderRadius: 16, background: 'transparent', color: T.textSub, fontSize: 14, fontWeight: 500, marginTop: 8 }}>
        + הוסף פריט קבוע חדש
      </button>

      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }} onClick={() => setShowCreate(false)}>
          <div className="sheet-up" onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: '20px 20px 0 0', width: '100%', padding: '0 0 32px' }}>
            <div style={{ width: 40, height: 4, background: T.border, borderRadius: 2, margin: '10px auto 0' }} />
            <div style={{ padding: '12px 16px 0', fontWeight: 700, fontSize: 17, borderBottom: `1px solid ${T.border}`, paddingBottom: 12 }}>פריט קבוע חדש</div>
            <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 12, color: T.textSub, fontWeight: 700, marginBottom: 6 }}>תדירות</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                  {Object.entries(FREQ_LABELS).map(([k, v]) => (
                    <button key={k} onClick={() => setForm(f => ({ ...f, frequency: k }))}
                      style={{ padding: '6px 14px', borderRadius: 20, fontSize: 13, border: 'none', background: form.frequency === k ? T.accent : T.surfaceAlt, color: form.frequency === k ? '#fff' : T.text }}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: T.textSub, fontWeight: 700, marginBottom: 8 }}>אופן הוספה</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[{ v: true, l: 'אוטומטי', d: 'מוסיף לרשימה' }, { v: false, l: 'שאל אותי', d: 'מוצג כהצעה' }].map(({ v, l, d }) => (
                    <div key={String(v)} onClick={() => setForm(f => ({ ...f, auto_add: v }))}
                      style={{ flex: 1, padding: 10, borderRadius: 12, cursor: 'pointer', textAlign: 'center', border: form.auto_add === v ? `1.5px solid ${T.accent}` : `1px solid ${T.border}`, background: form.auto_add === v ? T.accentLight : T.surfaceAlt }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: form.auto_add === v ? T.accentText : T.text }}>{l}</div>
                      <div style={{ fontSize: 11, color: T.textSub }}>{d}</div>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={() => { create.mutate(form); setShowCreate(false) }}
                style={{ padding: 15, fontSize: 15, fontWeight: 700, background: T.accent, color: '#fff', border: 'none', borderRadius: 16, cursor: 'pointer' }}>
                שמור
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RecurringRow({ r, onToggle, paused }: { r: any; onToggle: (r: any) => void; paused?: boolean }) {
  const days = daysUntil(r.next_run_date)
  const urgency = days <= 1 ? T.red : days <= 3 ? T.amber : T.accent
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', gap: 12, borderBottom: `1px solid ${T.border}`, opacity: paused ? 0.55 : 1 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{r.catalog_item?.name_he}</div>
        <div style={{ fontSize: 12, color: T.textSub, display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
          <span>{FREQ_LABELS[r.frequency]}</span>
          {!paused && <><span style={{ width: 6, height: 6, borderRadius: '50%', background: urgency, flexShrink: 0 }} />
          <span style={{ color: urgency, fontWeight: 600 }}>{days === 0 ? 'היום' : days === 1 ? 'מחר' : `עוד ${days} ימים`}</span></>}
        </div>
      </div>
      <button onClick={() => onToggle(r)}
        style={{ width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', position: 'relative', background: r.is_enabled ? T.accent : T.border, transition: 'background 0.2s', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'all 0.2s', ...(r.is_enabled ? { right: 3 } : { left: 3 }) }} />
      </button>
    </div>
  )
}

// ── Catalog Screen ────────────────────────────────────────────────────────────
function CatalogScreen() {
  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState<string | undefined>()
  const { data: cats = [] } = useCategories()
  const { data: results } = useCatalogSearch(q, catFilter)
  const items = (results as any)?.items ?? []

  return (
    <div>
      <div style={{ padding: '12px 16px', background: T.surface, borderBottom: `1px solid ${T.border}`, position: 'sticky' as const, top: 57, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', background: T.surfaceAlt, borderRadius: 12, padding: '0 12px', border: `1px solid ${T.border}`, marginBottom: 10 }}>
          <span style={{ color: T.textHint, marginLeft: 8 }}>🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש בקטלוג..." dir="rtl"
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 14, padding: '10px 4px', outline: 'none', color: T.text }} />
        </div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' as const }}>
          <button onClick={() => setCatFilter(undefined)}
            style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, border: 'none', background: !catFilter ? T.accent : T.surfaceAlt, color: !catFilter ? '#fff' : T.textSub, whiteSpace: 'nowrap' as const, flexShrink: 0 }}>
            הכל
          </button>
          {(cats as any[]).map((cat) => (
            <button key={cat.id} onClick={() => setCatFilter(catFilter === cat.id ? undefined : cat.id)}
              style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, border: 'none', background: catFilter === cat.id ? T.accent : T.surfaceAlt, color: catFilter === cat.id ? '#fff' : T.textSub, whiteSpace: 'nowrap' as const, flexShrink: 0 }}>
              {cat.icon} {cat.name_he}
            </button>
          ))}
        </div>
      </div>
      {items.map((c: CatalogItem) => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, borderBottom: `1px solid ${T.border}`, background: T.surface }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: T.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
            {c.image_url ? <img src={c.image_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : <span style={{ fontSize: 22 }}>📦</span>}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{c.name_he}</div>
            <div style={{ fontSize: 12, color: T.textSub }}>{c.default_qty} {c.default_unit}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Shared ────────────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, color: T.textSub, fontWeight: 700, marginBottom: 10, letterSpacing: '0.04em' }}>{title}</div>
      <div style={{ background: T.surface, borderRadius: 16, overflow: 'hidden', border: `1px solid ${T.border}` }}>
        {children}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 24, textAlign: 'center', color: T.textHint, fontSize: 14 }}>{text}</div>
}

function BottomNav({ screen, setScreen, badgeCount }: { screen: Screen; setScreen: (s: Screen) => void; badgeCount: number }) {
  const tabs = [
    { id: 'list' as Screen, label: 'רשימה', icon: '📋' },
    { id: 'recurring' as Screen, label: 'קבועים', icon: '🔄', badge: badgeCount },
    { id: 'catalog' as Screen, label: 'קטלוג', icon: '🗂' },
  ]
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: 430, margin: '0 auto', background: T.surface, borderTop: `1px solid ${T.border}`, display: 'flex', zIndex: 40 }}>
      {tabs.map((tab) => {
        const active = screen === tab.id || (screen === 'shopping' && tab.id === 'list')
        return (
          <button key={tab.id} onClick={() => setScreen(tab.id)}
            style={{ flex: 1, padding: '10px 0 8px', border: 'none', background: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', position: 'relative' }}>
            {(tab as any).badge > 0 && (
              <span style={{ position: 'absolute', top: 6, right: 'calc(50% - 12px)', background: T.amber, color: '#fff', width: 16, height: 16, borderRadius: '50%', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {(tab as any).badge}
              </span>
            )}
            <span style={{ fontSize: 22 }}>{tab.icon}</span>
            <span style={{ fontSize: 10, fontWeight: active ? 700 : 400, color: active ? T.accent : T.textSub }}>{tab.label}</span>
            {active && <span style={{ position: 'absolute', bottom: 0, width: 24, height: 2.5, background: T.accent, borderRadius: 2 }} />}
          </button>
        )
      })}
    </div>
  )
}

function Toast({ msg, action, onDismiss }: { msg: string; action?: () => void; onDismiss: () => void }) {
  return (
    <div className="fade-in" style={{ position: 'fixed', bottom: 84, left: 16, right: 16, maxWidth: 398, margin: '0 auto', background: T.text, color: '#fff', borderRadius: 14, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 200, fontSize: 14 }}>
      <span>{msg}</span>
      <div style={{ display: 'flex', gap: 12 }}>
        {action && <button onClick={() => { action(); onDismiss() }} style={{ background: 'none', border: 'none', color: T.amberLight, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>בטל</button>}
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 18, cursor: 'pointer' }}>×</button>
      </div>
    </div>
  )
}
