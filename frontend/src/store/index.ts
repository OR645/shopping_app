import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, Household, ShoppingList, ListItem, ToastData } from '../types'
import { setAccessToken, clearAccessToken } from '../api/client'

// ── Auth slice ────────────────────────────────────────────────────────────────
interface AuthSlice {
  user: User | null
  isAuthenticated: boolean
  setUser: (user: User, token: string, expiresIn: number) => void
  logout: () => void
}

// ── App slice ─────────────────────────────────────────────────────────────────
interface AppSlice {
  // Active selections
  activeHouseholdId: string | null
  activeListId: string | null
  setActiveHousehold: (id: string) => void
  setActiveList: (id: string) => void

  // Households & lists (local cache for instant UI)
  households: Household[]
  lists: ShoppingList[]
  setHouseholds: (h: Household[]) => void
  setLists: (l: ShoppingList[]) => void
  updateList: (listId: string, patch: Partial<ShoppingList>) => void

  // List items (keyed by list id)
  itemsByList: Record<string, ListItem[]>
  setItems: (listId: string, items: ListItem[]) => void
  upsertItem: (listId: string, item: ListItem) => void
  removeItem: (listId: string, itemId: string) => void
  patchItemStatus: (listId: string, itemId: string, status: 'pending' | 'purchased') => void

  // Presence — who is currently shopping
  presenceByList: Record<string, string[]>
  setPresence: (listId: string, userIds: string[]) => void

  // Offline
  isOffline: boolean
  setOffline: (v: boolean) => void

  // Toast
  toast: ToastData | null
  showToast: (msg: string, action?: () => void) => void
  clearToast: () => void
}

type Store = AuthSlice & AppSlice

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      // ── Auth ────────────────────────────────────────────────────────────────
      user: null,
      isAuthenticated: false,

      setUser: (user, token, expiresIn) => {
        setAccessToken(token, expiresIn)
        set({ user, isAuthenticated: true })
      },

      logout: () => {
        clearAccessToken()
        set({
          user: null,
          isAuthenticated: false,
          households: [],
          lists: [],
          itemsByList: {},
          activeHouseholdId: null,
          activeListId: null,
        })
      },

      // ── App ─────────────────────────────────────────────────────────────────
      activeHouseholdId: null,
      activeListId: null,
      setActiveHousehold: (id) => set({ activeHouseholdId: id }),
      setActiveList: (id) => set({ activeListId: id }),

      households: [],
      lists: [],
      setHouseholds: (households) => set({ households }),
      setLists: (lists) => set({ lists }),
      updateList: (listId, patch) =>
        set((s) => ({
          lists: s.lists.map((l) => (l.id === listId ? { ...l, ...patch } : l)),
        })),

      itemsByList: {},
      setItems: (listId, items) =>
        set((s) => ({ itemsByList: { ...s.itemsByList, [listId]: items } })),

      upsertItem: (listId, item) =>
        set((s) => {
          const current = s.itemsByList[listId] ?? []
          const exists = current.find((i) => i.id === item.id)
          return {
            itemsByList: {
              ...s.itemsByList,
              [listId]: exists
                ? current.map((i) => (i.id === item.id ? item : i))
                : [...current, item],
            },
          }
        }),

      removeItem: (listId, itemId) =>
        set((s) => ({
          itemsByList: {
            ...s.itemsByList,
            [listId]: (s.itemsByList[listId] ?? []).filter((i) => i.id !== itemId),
          },
        })),

      patchItemStatus: (listId, itemId, status) =>
        set((s) => ({
          itemsByList: {
            ...s.itemsByList,
            [listId]: (s.itemsByList[listId] ?? []).map((i) =>
              i.id === itemId ? { ...i, status, updated_at: new Date().toISOString() } : i
            ),
          },
        })),

      presenceByList: {},
      setPresence: (listId, userIds) =>
        set((s) => ({ presenceByList: { ...s.presenceByList, [listId]: userIds } })),

      isOffline: false,
      setOffline: (v) => set({ isOffline: v }),

      toast: null,
      showToast: (msg, action) => {
        const id = Math.random().toString(36).slice(2)
        set({ toast: { id, msg, action } })
        setTimeout(() => {
          // Only clear if it's still the same toast
          if (get().toast?.id === id) set({ toast: null })
        }, 4000)
      },
      clearToast: () => set({ toast: null }),
    }),
    {
      name: 'shopping-app-store',
      // Only persist auth + selections — items are fetched fresh
      partialize: (s) => ({
        user: s.user,
        isAuthenticated: s.isAuthenticated,
        activeHouseholdId: s.activeHouseholdId,
        activeListId: s.activeListId,
      }),
    }
  )
)

// ── Selectors ─────────────────────────────────────────────────────────────────
export const selectActiveList = (s: Store) =>
  s.lists.find((l) => l.id === s.activeListId) ?? null

export const selectActiveItems = (s: Store): ListItem[] =>
  s.activeListId ? (s.itemsByList[s.activeListId] ?? []) : []

export const selectPendingItems = (s: Store): ListItem[] =>
  selectActiveItems(s).filter((i) => i.status === 'pending')

export const selectPurchasedItems = (s: Store): ListItem[] =>
  selectActiveItems(s).filter((i) => i.status === 'purchased')
