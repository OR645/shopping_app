import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore, selectActiveItems, selectPendingItems } from './store'
import {
  useHouseholds, useLists, useListItems, useCategories,
  useCatalogSearch, useAddItem, useToggleItem, useDeleteItem,
  useUpdateItem, useCreateCatalogItem, useUpdateCatalogItem, useDeleteCatalogItem,
  useUploadCatalogImage, useRecurring, useCreateRecurring,
  useUpdateRecurring, useListWebSocket, useOfflineSync,
} from './hooks'
import { api } from './api/client'
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
  bgAlt: '#F0EDE6',
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
  const { isAuthenticated } = useStore()
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')

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

  useHouseholds()
  const { data: lists = [] } = useLists(activeHouseholdId ?? undefined)
  useListItems(activeListId ?? '')
  const { data: recurringData = [] } = useRecurring(activeHouseholdId ?? '')

  useOfflineSync(activeListId ?? '')
  useListWebSocket(activeListId ?? '')

  const { toast, clearToast, showToast, isOffline } = useStore()
  const items = useStore(selectActiveItems)
  const toggleItem = useToggleItem(activeListId ?? '')
  const deleteItem = useDeleteItem(activeListId ?? '')
  const addItem = useAddItem(activeListId ?? '')

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
            listId={activeListId ?? ''}
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
function ListScreen({ items, listId, suggestions, onToggle, onDelete, onAddSuggestion }: any) {
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
                {pending.map((item) => <ItemRow key={item.id} item={item} listId={listId} onToggle={onToggle} onDelete={onDelete} />)}
              </>
            )}
            {purchased.map((item) => <ItemRow key={item.id} item={item} listId={listId} onToggle={onToggle} onDelete={onDelete} purchased />)}
          </div>
        )
      })}
    </div>
  )
}

// ── Item Row ──────────────────────────────────────────────────────────────────
function ItemRow({ item, listId, onToggle, onDelete, purchased }: { item: ListItem; listId: string; onToggle: (id: string) => void; onDelete: (id: string) => void; purchased?: boolean }) {
  const cat = item.catalog_item as any
  const updateItem = useUpdateItem(listId)
  const [editOpen, setEditOpen] = useState(false)
  const [swipeX, setSwipeX] = useState(0)
  const touchStartX = useRef(0)
  const SWIPE_THRESHOLD = 72

  const changeQty = (delta: number) => {
    const current = parseFloat(String(item.quantity))
    const step = current >= 2 ? 1 : 0.25
    const next = Math.max(0.25, current + (delta > 0 ? step : -step))
    updateItem.mutate({ itemId: item.id, quantity: next })
  }

  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX }
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX
    setSwipeX(diff > SWIPE_THRESHOLD ? -SWIPE_THRESHOLD : 0)
  }

  return (
    <>
      {editOpen && <EditItemSheet item={item} listId={listId} onClose={() => setEditOpen(false)} />}

      <div style={{ position: 'relative', overflow: 'hidden', borderBottom: `1px solid ${T.border}` }}>
        {/* Swipe-revealed action buttons */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, right: 0,
          display: 'flex', alignItems: 'stretch',
          width: SWIPE_THRESHOLD * 2,
          transform: `translateX(${swipeX === 0 ? '100%' : '0'})`,
          transition: 'transform 0.2s',
        }}>
          <button
            onClick={() => { setSwipeX(0); setEditOpen(true) }}
            style={{ flex: 1, background: '#4A90D9', color: '#fff', border: 'none', fontSize: 18, fontWeight: 600 }}
          >✏️</button>
          <button
            onClick={() => { setSwipeX(0); onDelete(item.id) }}
            style={{ flex: 1, background: T.red, color: '#fff', border: 'none', fontSize: 18, fontWeight: 600 }}
          >🗑</button>
        </div>

        {/* Main row */}
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onClick={() => swipeX !== 0 ? setSwipeX(0) : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            background: T.surface, opacity: purchased ? 0.55 : 1,
            transform: `translateX(${swipeX}px)`, transition: 'transform 0.2s',
            minHeight: 58,
          }}
        >
          {/* Checkbox */}
          <div
            onClick={() => onToggle(item.id)}
            style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, border: purchased ? `2px solid ${T.accent}` : `2px solid ${T.borderStrong}`, background: purchased ? T.accentLight : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
          >
            {purchased && <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </div>

          {/* Thumbnail */}
          {cat?.image_url && (
            <img src={cat.image_url} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
          )}

          {/* Text */}
          <div style={{ flex: 1, minWidth: 0 }} onClick={() => onToggle(item.id)}>
            <div style={{ fontSize: 15, fontWeight: 500, color: purchased ? T.purchased : T.text, textDecoration: purchased ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>
              {cat?.name_he}
            </div>
            {item.note && (
              <div style={{ fontSize: 11, color: T.textSub, marginTop: 1 }}>{item.note}</div>
            )}
          </div>

          {/* Quantity stepper (inline, only when pending) */}
          {!purchased && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
              <button
                onClick={e => { e.stopPropagation(); changeQty(-1) }}
                style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${T.border}`, background: T.bgAlt, color: T.accent, fontWeight: 700, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
              >−</button>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text, minWidth: 38, textAlign: 'center' }}>
                {Number(item.quantity) % 1 === 0 ? Number(item.quantity) : item.quantity} {item.unit}
              </span>
              <button
                onClick={e => { e.stopPropagation(); changeQty(1) }}
                style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${T.border}`, background: T.bgAlt, color: T.accent, fontWeight: 700, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
              >+</button>
            </div>
          )}

          {/* Edit button */}
          <button
            onClick={e => { e.stopPropagation(); setEditOpen(true) }}
            style={{ background: 'none', border: 'none', fontSize: 15, color: T.textSub, padding: '4px', flexShrink: 0 }}
          >✏️</button>
        </div>
      </div>
    </>
  )
}

// ── Edit Item Sheet ────────────────────────────────────────────────────────────
function EditItemSheet({ item, listId, onClose }: { item: ListItem; listId: string; onClose: () => void }) {
  const cat = item.catalog_item as any
  const updateItem = useUpdateItem(listId)
  const uploadImage = useUploadCatalogImage()

  const [qty, setQty] = useState(String(item.quantity))
  const [unit, setUnit] = useState(item.unit)
  const [note, setNote] = useState(item.note ?? '')
  const [imagePreview, setImagePreview] = useState<string | null>(cat?.image_url ?? null)
  const fileRef = useRef<HTMLInputElement>(null)

  const save = async () => {
    await updateItem.mutateAsync({
      itemId: item.id,
      quantity: parseFloat(qty) || 1,
      unit,
      note,
    })
    onClose()
  }

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !cat?.id) return
    setImagePreview(URL.createObjectURL(file))
    await uploadImage.mutateAsync({ itemId: cat.id, file })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div className="sheet-up" onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: '20px 20px 0 0', width: '100%', padding: '0 0 32px', maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>עריכת פריט</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: T.textSub, padding: 4 }}>✕</button>
        </div>

        <div style={{ padding: '20px 20px 0' }}>
          {/* Image + name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <div
              onClick={() => fileRef.current?.click()}
              style={{ width: 72, height: 72, borderRadius: 14, overflow: 'hidden', background: T.bgAlt, border: `2px dashed ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, position: 'relative' }}
            >
              {imagePreview
                ? <img src={imagePreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 28, opacity: 0.4 }}>📷</span>
              }
              <div style={{ position: 'absolute', bottom: 2, right: 2, background: T.accent, borderRadius: 6, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>+</span>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImagePick} />
            <div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>{cat?.name_he}</div>
              {cat?.name_en && <div style={{ fontSize: 13, color: T.textSub }}>{cat.name_en}</div>}
              <div style={{ fontSize: 11, color: T.textSub, marginTop: 2 }}>לחץ על התמונה להוספה/החלפה</div>
            </div>
          </div>

          {/* Quantity row */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: T.textSub, display: 'block', marginBottom: 6 }}>כמות ויחידות</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden', flex: 1 }}>
                <button
                  onClick={() => setQty(v => String(Math.max(0.25, parseFloat(v) - (parseFloat(v) >= 2 ? 1 : 0.25))))}
                  style={{ background: 'none', border: 'none', padding: '10px 16px', fontSize: 20, color: T.accent, fontWeight: 700 }}
                >−</button>
                <input
                  type="number"
                  value={qty}
                  onChange={e => setQty(e.target.value)}
                  style={{ flex: 1, textAlign: 'center', border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, background: 'transparent', color: T.text }}
                  min="0.25" step="0.25"
                />
                <button
                  onClick={() => setQty(v => String(parseFloat(v) + (parseFloat(v) >= 2 ? 1 : 0.25)))}
                  style={{ background: 'none', border: 'none', padding: '10px 16px', fontSize: 20, color: T.accent, fontWeight: 700 }}
                >+</button>
              </div>
              <input
                value={unit}
                onChange={e => setUnit(e.target.value)}
                placeholder="יחידות"
                style={{ width: 90, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 12px', fontSize: 14, background: T.bg, color: T.text, textAlign: 'center' }}
              />
            </div>
          </div>

          {/* Note */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: T.textSub, display: 'block', marginBottom: 6 }}>הערה</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="לדוגמה: ללא גלוטן, מותג X..."
              style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 10, padding: '11px 14px', fontSize: 14, background: T.bg, color: T.text }}
            />
          </div>

          <button
            onClick={save}
            disabled={updateItem.isLoading}
            style={{ width: '100%', background: T.accent, color: '#fff', border: 'none', borderRadius: 12, padding: '14px', fontSize: 16, fontWeight: 700 }}
          >
            {updateItem.isLoading ? 'שומר...' : '💾 שמור שינויים'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Shopping Mode ─────────────────────────────────────────────────────────────
function ShoppingMode({ items, onToggle }: { items: ListItem[]; onToggle: (id: string) => void }) {
  const { data: categories = [] } = useCategories()
  const catMap = Object.fromEntries((categories as any[]).map((c: any) => [c.id, c]))
  const byCat: Record<string, ListItem[]> = {}
  items.forEach((i) => { const c = i.catalog_item?.category_id ?? 'other'; if (!byCat[c]) byCat[c] = []; byCat[c].push(i) })

  const done = items.filter(i => i.status === 'purchased').length
  const pct = items.length ? Math.round((done / items.length) * 100) : 0

  return (
    <div>
      <div style={{ padding: '12px 16px', background: T.surface, borderBottom: `1px solid ${T.border}`, position: 'sticky' as const, top: 57, zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, color: T.textSub }}>
          <span>התקדמות</span><span>{done} / {items.length}</span>
        </div>
        <div style={{ height: 6, background: T.border, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: T.accent, borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
      </div>
      {Object.entries(byCat).map(([catId, catItems]) => {
        const cat = catMap[catId] as any
        return (
          <div key={catId} style={{ marginBottom: 8 }}>
            <div style={{ padding: '10px 16px 4px', fontSize: 11, fontWeight: 700, color: T.textSub, letterSpacing: '0.05em' }}>
              {cat?.icon} {cat?.name_he}
            </div>
            {catItems.map(item => (
              <div key={item.id} onClick={() => onToggle(item.id)}
                style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, background: T.surface, borderBottom: `1px solid ${T.border}`, cursor: 'pointer', opacity: item.status === 'purchased' ? 0.5 : 1 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', border: item.status === 'purchased' ? `2px solid ${T.accent}` : `2px solid ${T.borderStrong}`, background: item.status === 'purchased' ? T.accentLight : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {item.status === 'purchased' && <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" /></svg>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: item.status === 'purchased' ? 400 : 500, color: item.status === 'purchased' ? T.purchased : T.text, textDecoration: item.status === 'purchased' ? 'line-through' : 'none' }}>
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

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 120) }, [])

  const catalogItems = (results as any)?.items ?? []

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div className="sheet-up" onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: '20px 20px 0 0', width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' as const }}>
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', background: T.surfaceAlt, borderRadius: 12, padding: '0 12px', border: `1px solid ${T.border}` }}>
            <span style={{ color: T.textHint, marginLeft: 8 }}>🔍</span>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש פריט..." dir="rtl"
              style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 15, padding: '12px 4px', outline: 'none', color: T.text }} />
          </div>
        </div>
        <div style={{ overflowY: 'auto' as const, flex: 1 }}>
          {catalogItems.map((c: CatalogItem) => (
            <div key={c.id} className="row-tap" onClick={() => onSelect(c)}
              style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, cursor: 'pointer', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: T.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
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
            <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column' as const, gap: 14 }}>
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
              <button
                onClick={() => {
                  if (!form.catalog_item_id) return
                  create.mutate(form)
                  setShowCreate(false)
                }}
                style={{ padding: 14, background: T.accent, color: '#fff', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 700 }}>
                שמור פריט קבוע
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
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, borderBottom: `1px solid ${T.border}`, opacity: paused ? 0.5 : 1 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{r.catalog_item?.name_he}</div>
        <div style={{ fontSize: 12, color: T.textSub, marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>{FREQ_LABELS[r.frequency]}</span>
          {!paused && <><span>·</span><span style={{ color: days <= 1 ? T.accent : T.textSub }}>{days === 0 ? 'היום' : days === 1 ? 'מחר' : `עוד ${days} ימים`}</span></>}
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
  const [editItem, setEditItem] = useState<any | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const { data: cats = [] } = useCategories()
  const { data: results } = useCatalogSearch(q, catFilter)
  const catalogItems = (results as any)?.items ?? []
  const deleteCatalogItem = useDeleteCatalogItem()
  const updateCatalogItem = useUpdateCatalogItem()

  return (
    <div>
      {/* Search + Add button */}
      <div style={{ padding: '12px 16px', background: T.surface, borderBottom: `1px solid ${T.border}`, position: 'sticky' as const, top: 57, zIndex: 10 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', background: T.surfaceAlt, borderRadius: 12, padding: '0 12px', border: `1px solid ${T.border}`, flex: 1 }}>
            <span style={{ color: T.textHint, marginLeft: 8 }}>🔍</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש בקטלוג..." dir="rtl"
              style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 14, padding: '10px 4px', outline: 'none', color: T.text }} />
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '0 16px', fontWeight: 700, fontSize: 14, flexShrink: 0 }}
          >+ הוסף</button>
        </div>

        {/* Category chips */}
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

      {/* Items list */}
      {catalogItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: T.textHint }}>
          {q ? 'לא נמצאו פריטים' : 'הקטלוג ריק. לחץ "+ הוסף" ליצירת פריט ראשון.'}
        </div>
      )}
      {catalogItems.map((ci: any) => (
        <CatalogItemRow
          key={ci.id}
          item={ci}
          categories={cats as any[]}
          onEdit={() => setEditItem(ci)}
          onDelete={() => deleteCatalogItem.mutate(ci.id)}
        />
      ))}

      {/* Edit sheet */}
      {editItem && (
        <EditCatalogItemSheet
          item={editItem}
          categories={cats as any[]}
          onClose={() => setEditItem(null)}
          onSave={data => updateCatalogItem.mutateAsync({ itemId: editItem.id, ...data }).then(() => setEditItem(null))}
        />
      )}

      {/* Create sheet */}
      {createOpen && (
        <CreateCatalogItemSheet
          categories={cats as any[]}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  )
}

// ── Catalog Item Row ──────────────────────────────────────────────────────────
function CatalogItemRow({ item, categories, onEdit, onDelete }: { item: any; categories: any[]; onEdit: () => void; onDelete: () => void }) {
  const cat = categories.find(c => c.id === item.category_id)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const uploadImage = useUploadCatalogImage()
  const [imgPreview, setImgPreview] = useState<string | null>(item.image_url ?? null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImgPreview(URL.createObjectURL(file))
    await uploadImage.mutateAsync({ itemId: item.id, file })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
      {/* Tappable image */}
      <div
        onClick={() => fileRef.current?.click()}
        style={{ width: 48, height: 48, borderRadius: 10, overflow: 'hidden', background: T.bgAlt, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, position: 'relative' }}
      >
        {imgPreview
          ? <img src={imgPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 22 }}>{cat?.icon ?? '📦'}</span>
        }
        <div style={{ position: 'absolute', bottom: 1, right: 1, background: T.accent, borderRadius: 4, width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>+</span>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name_he}</div>
        <div style={{ fontSize: 11, color: T.textSub }}>
          {cat?.name_he} · {item.default_qty} {item.default_unit}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button onClick={onEdit} style={{ background: T.bgAlt, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 13, color: T.text }}>✏️</button>
        {confirmDelete ? (
          <button onClick={() => { onDelete(); setConfirmDelete(false) }} style={{ background: T.red, border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#fff', fontWeight: 600 }}>אשר</button>
        ) : (
          <button onClick={() => setConfirmDelete(true)} style={{ background: T.bgAlt, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 13, color: T.red }}>🗑</button>
        )}
      </div>
    </div>
  )
}

// ── Edit Catalog Item Sheet ────────────────────────────────────────────────────
function EditCatalogItemSheet({ item, categories, onClose, onSave }: { item: any; categories: any[]; onClose: () => void; onSave: (data: any) => Promise<void> }) {
  const [nameHe, setNameHe] = useState(item.name_he)
  const [nameEn, setNameEn] = useState(item.name_en ?? '')
  const [categoryId, setCategoryId] = useState(item.category_id)
  const [defaultQty, setDefaultQty] = useState(String(item.default_qty))
  const [defaultUnit, setDefaultUnit] = useState(item.default_unit)
  const [barcode, setBarcode] = useState(item.barcode ?? '')
  const [saving, setSaving] = useState(false)
  const [imgPreview, setImgPreview] = useState<string | null>(item.image_url ?? null)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadImage = useUploadCatalogImage()

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImgPreview(URL.createObjectURL(file))
    await uploadImage.mutateAsync({ itemId: item.id, file })
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave({ name_he: nameHe, name_en: nameEn || undefined, category_id: categoryId, default_qty: parseFloat(defaultQty) || 1, default_unit: defaultUnit, barcode: barcode || undefined })
    } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div className="sheet-up" onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: '20px 20px 0 0', width: '100%', padding: '0 0 32px', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>עריכת פריט קטלוג</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: T.textSub }}>✕</button>
        </div>
        <div style={{ padding: '20px' }}>
          {/* Image */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <div onClick={() => fileRef.current?.click()} style={{ width: 90, height: 90, borderRadius: 16, overflow: 'hidden', background: T.bgAlt, border: `2px dashed ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}>
              {imgPreview ? <img src={imgPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 36, opacity: 0.4 }}>📷</span>}
              <div style={{ position: 'absolute', bottom: 4, right: 4, background: T.accent, borderRadius: 8, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>+</span>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
          </div>

          {/* Fields */}
          {[
            { label: 'שם בעברית *', value: nameHe, setter: setNameHe, placeholder: 'שם הפריט' },
            { label: 'שם באנגלית', value: nameEn, setter: setNameEn, placeholder: 'English name (optional)' },
            { label: 'ברקוד', value: barcode, setter: setBarcode, placeholder: '1234567890' },
          ].map(({ label, value, setter, placeholder }) => (
            <div key={label} style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: T.textSub, display: 'block', marginBottom: 5 }}>{label}</label>
              <input value={value} onChange={e => setter(e.target.value)} placeholder={placeholder} style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 14, background: T.bg, color: T.text }} />
            </div>
          ))}

          {/* Category */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: T.textSub, display: 'block', marginBottom: 5 }}>קטגוריה</label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 14, background: T.bg, color: T.text }}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name_he}</option>)}
            </select>
          </div>

          {/* Qty + unit */}
          <div style={{ marginBottom: 20, display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: T.textSub, display: 'block', marginBottom: 5 }}>כמות ברירת מחדל</label>
              <input type="number" value={defaultQty} onChange={e => setDefaultQty(e.target.value)} min="0.25" step="0.25" style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 14, background: T.bg, color: T.text }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: T.textSub, display: 'block', marginBottom: 5 }}>יחידה</label>
              <input value={defaultUnit} onChange={e => setDefaultUnit(e.target.value)} style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 14, background: T.bg, color: T.text }} />
            </div>
          </div>

          <button onClick={save} disabled={saving || !nameHe.trim()} style={{ width: '100%', background: T.accent, color: '#fff', border: 'none', borderRadius: 12, padding: 14, fontSize: 16, fontWeight: 700 }}>
            {saving ? 'שומר...' : '💾 שמור שינויים'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Create Catalog Item Sheet ─────────────────────────────────────────────────
function CreateCatalogItemSheet({ categories, onClose }: { categories: any[]; onClose: () => void }) {
  const createItem = useCreateCatalogItem()
  const uploadImage = useUploadCatalogImage()

  const [nameHe, setNameHe] = useState('')
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [defaultQty, setDefaultQty] = useState('1')
  const [defaultUnit, setDefaultUnit] = useState('יחידות')
  const [imgPreview, setImgPreview] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImgPreview(URL.createObjectURL(file))
    if (createdId) await uploadImage.mutateAsync({ itemId: createdId, file })
  }

  const create = async () => {
    if (!nameHe.trim()) return
    const res = await createItem.mutateAsync({ name_he: nameHe.trim(), category_id: categoryId, default_qty: parseFloat(defaultQty) || 1, default_unit: defaultUnit }) as any
    setCreatedId(res.id)
    if (fileRef.current?.files?.[0]) {
      await uploadImage.mutateAsync({ itemId: res.id, file: fileRef.current.files[0] })
    }
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div className="sheet-up" onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: '20px 20px 0 0', width: '100%', padding: '0 0 32px', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>פריט חדש בקטלוג</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: T.textSub }}>✕</button>
        </div>
        <div style={{ padding: 20 }}>
          {/* Image */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <div onClick={() => fileRef.current?.click()} style={{ width: 80, height: 80, borderRadius: 14, overflow: 'hidden', background: T.bgAlt, border: `2px dashed ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              {imgPreview ? <img src={imgPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 32, opacity: 0.4 }}>📷</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: T.textSub, display: 'block', marginBottom: 5 }}>שם בעברית *</label>
            <input value={nameHe} onChange={e => setNameHe(e.target.value)} autoFocus placeholder="שם הפריט" style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 14, background: T.bg, color: T.text }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: T.textSub, display: 'block', marginBottom: 5 }}>קטגוריה</label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 14, background: T.bg, color: T.text }}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name_he}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: T.textSub, display: 'block', marginBottom: 5 }}>כמות</label>
              <input type="number" value={defaultQty} onChange={e => setDefaultQty(e.target.value)} min="0.25" step="0.25" style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 14, background: T.bg, color: T.text }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: T.textSub, display: 'block', marginBottom: 5 }}>יחידה</label>
              <input value={defaultUnit} onChange={e => setDefaultUnit(e.target.value)} style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 14, background: T.bg, color: T.text }} />
            </div>
          </div>

          <button onClick={create} disabled={createItem.isLoading || !nameHe.trim()} style={{ width: '100%', background: T.accent, color: '#fff', border: 'none', borderRadius: 12, padding: 14, fontSize: 16, fontWeight: 700 }}>
            {createItem.isLoading ? 'יוצר...' : '+ צור פריט'}
          </button>
        </div>
      </div>
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
            style={{ flex: 1, padding: '10px 0 8px', border: 'none', background: 'none', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 3, cursor: 'pointer', position: 'relative' }}>
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
