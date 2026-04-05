import { useQuery, useMutation, useQueryClient } from 'react-query'
import { api, enqueueOfflineMutation, drainOfflineQueue, setAccessToken } from '../api/client'
import { useStore } from '../store'
import type { CatalogItem, ListItem, RecurringItem } from '../types'
import { useEffect, useRef, useCallback } from 'react'
import { createListWebSocket } from '../api/client'

const QK = {
  me: ['me'],
  households: ['households'],
  lists: (householdId?: string) => ['lists', householdId],
  items: (listId: string) => ['items', listId],
  catalog: (q: string, cat?: string) => ['catalog', q, cat],
  categories: ['categories'],
  recurring: (householdId: string) => ['recurring', householdId],
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function useMe() {
  const { setUser, isAuthenticated } = useStore()
  return useQuery(QK.me, () => api.auth.me(), {
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
    onSuccess: (user) => {
      // Re-hydrate user object after page reload
      useStore.getState().setUser(
        user as any,
        '', // token already in memory from persist
        900
      )
    },
  })
}

export function useLogin() {
  const { setUser, showToast } = useStore()
  return useMutation(
    ({ email, password }: { email: string; password: string }) =>
      api.auth.login({ email, password }),
    {
      onSuccess: async (token) => {
        // Set token in memory FIRST so /me request is authenticated
        setAccessToken(token.access_token, token.expires_in)
        const user = await api.auth.me()
        setUser(user as any, token.access_token, token.expires_in)
      },
      onError: (err: Error) => showToast(err.message),
    }
  )
}

export function useRegister() {
  const { setUser, showToast } = useStore()
  return useMutation(
    (body: { email: string; password: string; name: string; grammatical_gender?: string }) =>
      api.auth.register(body),
    {
      onSuccess: async (token) => {
        // Set token in memory FIRST so /me request is authenticated
        setAccessToken(token.access_token, token.expires_in)
        const user = await api.auth.me()
        setUser(user as any, token.access_token, token.expires_in)
      },
      onError: (err: Error) => showToast(err.message),
    }
  )
}

// ── Households ────────────────────────────────────────────────────────────────

export function useHouseholds() {
  const { setHouseholds, setActiveHousehold, activeHouseholdId } = useStore()
  return useQuery(QK.households, () => api.households.list(), {
    onSuccess: (data: any[]) => {
      setHouseholds(data)
      // Auto-select first household if none selected
      if (!activeHouseholdId && data.length > 0) {
        setActiveHousehold(data[0].id)
      }
    },
    staleTime: 60_000,
  })
}

export function useCreateHousehold() {
  const qc = useQueryClient()
  const { showToast } = useStore()
  return useMutation(
    (body: { name: string; emoji?: string }) => api.households.create(body),
    {
      onSuccess: () => {
        qc.invalidateQueries(QK.households)
        showToast('משק הבית נוצר בהצלחה')
      },
      onError: (err: Error) => showToast(err.message),
    }
  )
}

// ── Lists ─────────────────────────────────────────────────────────────────────

export function useLists(householdId?: string) {
  const { setLists, setActiveList, activeListId } = useStore()
  return useQuery(
    QK.lists(householdId),
    () => api.lists.list(householdId),
    {
      enabled: !!householdId,
      onSuccess: (data: any[]) => {
        setLists(data)
        // Auto-select first list if none selected
        if (!activeListId && data.length > 0) {
          setActiveList(data[0].id)
        }
      },
      staleTime: 30_000,
    }
  )
}

export function useListItems(listId: string) {
  const { setItems } = useStore()
  return useQuery(
    QK.items(listId),
    () => api.lists.items(listId),
    {
      enabled: !!listId,
      onSuccess: (data: any[]) => setItems(listId, data),
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    }
  )
}

export function useAddItem(listId: string) {
  const qc = useQueryClient()
  const { upsertItem, showToast, isOffline } = useStore()

  return useMutation(
    async (body: { catalog_item_id: string; quantity: number; unit: string; note?: string }) => {
      const idempotency_key = `add:${listId}:${body.catalog_item_id}:${Date.now()}`

      if (isOffline) {
        await enqueueOfflineMutation({
          idempotency_key,
          operation: 'POST',
          url: `/lists/${listId}/items`,
          body: { ...body, idempotency_key },
          vector_clock: {},
        })
        // Optimistic fake item for UI
        return { id: `temp_${idempotency_key}`, ...body, status: 'pending' } as any
      }

      return api.lists.addItem(listId, { ...body, idempotency_key })
    },
    {
      onSuccess: (item: any) => {
        qc.invalidateQueries(QK.items(listId))
      },
      onError: (err: Error) => showToast(err.message),
    }
  )
}

export function useUpdateItem(listId: string) {
  const qc = useQueryClient()
  const { showToast } = useStore()

  return useMutation(
    async ({ itemId, ...body }: { itemId: string; quantity?: number; unit?: string; note?: string }) => {
      return api.lists.updateItem(listId, itemId, body)
    },
    {
      onSuccess: () => qc.invalidateQueries(QK.items(listId)),
      onError: () => showToast('שגיאה בעדכון הפריט'),
    }
  )
}

export function useToggleItem(listId: string) {
  const { patchItemStatus, showToast, isOffline, user } = useStore()

  return useMutation(
    async ({ itemId, status }: { itemId: string; status: 'pending' | 'purchased' }) => {
      // Optimistic update immediately
      patchItemStatus(listId, itemId, status)

      const idempotency_key = `toggle:${itemId}:${status}:${Date.now()}`
      const vector_clock = user ? { [user.id]: Date.now() } : {}

      if (isOffline) {
        await enqueueOfflineMutation({
          idempotency_key,
          operation: 'PATCH',
          url: `/lists/${listId}/items/${itemId}/status`,
          body: { status, vector_clock, idempotency_key },
          vector_clock,
        })
        return
      }

      return api.lists.toggleStatus(listId, itemId, { status, vector_clock, idempotency_key })
    },
    {
      onError: (err: Error, { itemId, status }) => {
        // Rollback optimistic update
        patchItemStatus(listId, itemId, status === 'pending' ? 'purchased' : 'pending')
        showToast('שגיאה בעדכון הפריט')
      },
    }
  )
}

export function useDeleteItem(listId: string) {
  const qc = useQueryClient()
  const { removeItem, showToast } = useStore()

  return useMutation(
    async (itemId: string) => {
      removeItem(listId, itemId) // optimistic
      return api.lists.deleteItem(listId, itemId)
    },
    {
      onSuccess: () => qc.invalidateQueries(QK.items(listId)),
      onError: (err: Error) => {
        qc.invalidateQueries(QK.items(listId)) // refetch to restore
        showToast('שגיאה במחיקת הפריט')
      },
    }
  )
}

// ── Catalog ───────────────────────────────────────────────────────────────────

export function useCatalogSearch(q: string, category?: string) {
  return useQuery(
    QK.catalog(q, category),
    () => api.catalog.search(q, category),
    {
      enabled: q.length >= 1 || !!category,
      staleTime: 5 * 60_000,
      keepPreviousData: true,
    }
  )
}

export function useCategories() {
  return useQuery(QK.categories, () => api.catalog.categories(), {
    staleTime: Infinity, // Categories never change
  })
}

export function useCreateCatalogItem() {
  const qc = useQueryClient()
  const { showToast } = useStore()
  return useMutation(
    (body: { name_he: string; category_id: string; default_qty?: number; default_unit?: string; name_en?: string; barcode?: string }) =>
      api.catalog.create(body),
    {
      onSuccess: () => {
        qc.invalidateQueries(QK.catalog(''))
        showToast('הפריט נוסף לקטלוג')
      },
      onError: (err: Error) => showToast(err.message),
    }
  )
}

export function useUpdateCatalogItem() {
  const qc = useQueryClient()
  const { showToast } = useStore()

  return useMutation(
    async ({ itemId, ...body }: { itemId: string; name_he?: string; name_en?: string; category_id?: string; default_qty?: number; default_unit?: string; barcode?: string }) => {
      return api.catalog.update(itemId, body)
    },
    {
      onSuccess: () => {
        qc.invalidateQueries(QK.catalog(''))
        showToast('פריט עודכן בהצלחה')
      },
      onError: () => showToast('שגיאה בעדכון הפריט'),
    }
  )
}

export function useDeleteCatalogItem() {
  const qc = useQueryClient()
  const { showToast } = useStore()

  return useMutation(
    async (itemId: string) => api.catalog.delete(itemId),
    {
      onSuccess: () => {
        qc.invalidateQueries(QK.catalog(''))
        showToast('פריט נמחק מהקטלוג')
      },
      onError: () => showToast('שגיאה במחיקת הפריט'),
    }
  )
}

export function useUploadCatalogImage() {
  const qc = useQueryClient()
  return useMutation(
    async ({ itemId, file }: { itemId: string; file: File }) =>
      api.catalog.uploadImage(itemId, file),
    {
      onSuccess: () => qc.invalidateQueries(QK.catalog('')),
    }
  )
}

// ── Recurring Items ───────────────────────────────────────────────────────────

export function useRecurring(householdId: string) {
  return useQuery(
    QK.recurring(householdId),
    () => api.recurring.list(householdId),
    {
      enabled: !!householdId,
      staleTime: 60_000,
    }
  )
}

export function useCreateRecurring(householdId: string) {
  const qc = useQueryClient()
  const { showToast } = useStore()
  return useMutation(
    (body: unknown) => api.recurring.create(householdId, body),
    {
      onSuccess: () => {
        qc.invalidateQueries(QK.recurring(householdId))
        showToast('פריט קבוע נוסף')
      },
      onError: (err: Error) => showToast(err.message),
    }
  )
}

export function useUpdateRecurring(householdId: string) {
  const qc = useQueryClient()
  return useMutation(
    ({ id, body }: { id: string; body: unknown }) =>
      api.recurring.update(householdId, id, body),
    {
      onSuccess: () => qc.invalidateQueries(QK.recurring(householdId)),
    }
  )
}

// ── WebSocket realtime ────────────────────────────────────────────────────────

export function useListWebSocket(listId: string) {
  const { upsertItem, removeItem, patchItemStatus, setPresence } = useStore()
  const qc = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const { user } = useStore()

  const handleEvent = useCallback(
    (event: Record<string, any>) => {
      switch (event.type) {
        case 'item_added':
          // Refetch to get full item with catalog data
          qc.invalidateQueries(QK.items(listId))
          break

        case 'item_status_changed':
          // Only update if it came from another user
          if (event.by_user !== user?.id) {
            patchItemStatus(listId, event.item_id, event.status)
          }
          break

        case 'item_updated':
          if (event.by_user !== user?.id) {
            qc.invalidateQueries(QK.items(listId))
          }
          break

        case 'item_deleted':
          if (event.by_user !== user?.id) {
            removeItem(listId, event.item_id)
          }
          break

        case 'presence_update': {
          // Track who is currently viewing this list
          const current = useStore.getState().presenceByList[listId] ?? []
          if (event.event === 'joined') {
            setPresence(listId, [...new Set([...current, event.user_id])])
          } else if (event.event === 'left') {
            setPresence(listId, current.filter((id) => id !== event.user_id))
          }
          break
        }

        case 'replay':
          // Missed events while offline — refetch
          qc.invalidateQueries(QK.items(listId))
          break
      }
    },
    [listId, user?.id, qc, upsertItem, removeItem, patchItemStatus, setPresence]
  )

  useEffect(() => {
    if (!listId || !user) return

    // Get access token from store (memory)
    const { accessToken } = (window as any).__shopping_token ?? {}
    if (!accessToken) return

    const cursor = localStorage.getItem(`cursor:${listId}`) ?? undefined
    const ws = createListWebSocket(listId, accessToken, handleEvent, cursor)
    wsRef.current = ws

    // Update cursor on clean disconnect
    return () => {
      localStorage.setItem(`cursor:${listId}`, new Date().toISOString())
      ws.close()
    }
  }, [listId, user?.id])

  return wsRef
}

// ── Offline sync ──────────────────────────────────────────────────────────────

export function useOfflineSync(listId: string) {
  const { isOffline, setOffline, showToast } = useStore()
  const qc = useQueryClient()

  useEffect(() => {
    const handleOnline = async () => {
      setOffline(false)
      showToast('החיבור חזר — מסנכרן...')
      await drainOfflineQueue(listId)
      qc.invalidateQueries(QK.items(listId))
    }

    const handleOffline = () => {
      setOffline(true)
      showToast('אין חיבור — עובד במצב לא מקוון')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    setOffline(!navigator.onLine)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [listId])
}
