/**
 * API client for the shopping app.
 * Handles:
 *  - JWT auth headers (access token in memory, refresh via httpOnly cookie)
 *  - Offline mutation queue (IndexedDB via idb)
 *  - Automatic token refresh on 401
 */

import { openDB, IDBPDatabase } from 'idb'

// ── Token store (memory only — never localStorage) ────────────────────────────
let accessToken: string | null = null
let tokenExpiry: number = 0  // unix seconds

export function setAccessToken(token: string, expiresIn: number) {
  accessToken = token
  tokenExpiry = Math.floor(Date.now() / 1000) + expiresIn - 30  // 30s buffer
}

export function clearAccessToken() {
  accessToken = null
  tokenExpiry = 0
}

function isTokenExpired(): boolean {
  return !accessToken || Math.floor(Date.now() / 1000) >= tokenExpiry
}

// ── IndexedDB for offline queue ────────────────────────────────────────────────
interface QueuedMutation {
  id: string
  idempotency_key: string
  operation: 'POST' | 'PATCH' | 'DELETE'
  url: string
  body: Record<string, unknown>
  vector_clock: Record<string, number>
  created_at: number
}

let db: IDBPDatabase | null = null

async function getDB() {
  if (db) return db
  db = await openDB('shopping-app', 1, {
    upgrade(database) {
      // Mutation queue
      if (!database.objectStoreNames.contains('mutation_queue')) {
        database.createObjectStore('mutation_queue', { keyPath: 'id' })
      }
      // Local snapshots of list items
      if (!database.objectStoreNames.contains('list_items')) {
        const store = database.createObjectStore('list_items', { keyPath: 'id' })
        store.createIndex('by_list', 'list_id')
      }
      // Recent items per list (for fast-add history pills)
      if (!database.objectStoreNames.contains('recent_items')) {
        database.createObjectStore('recent_items', { keyPath: 'id' })
      }
      // Catalog cache
      if (!database.objectStoreNames.contains('catalog_cache')) {
        database.createObjectStore('catalog_cache', { keyPath: 'id' })
      }
    },
  })
  return db
}

export async function enqueueOfflineMutation(mutation: Omit<QueuedMutation, 'id' | 'created_at'>) {
  const database = await getDB()
  const entry: QueuedMutation = {
    ...mutation,
    id: crypto.randomUUID(),
    created_at: Date.now(),
  }
  await database.put('mutation_queue', entry)
  return entry
}

export async function getOfflineQueue(): Promise<QueuedMutation[]> {
  const database = await getDB()
  const all = await database.getAll('mutation_queue')
  return all.sort((a, b) => a.created_at - b.created_at)
}

export async function clearMutationFromQueue(id: string) {
  const database = await getDB()
  await database.delete('mutation_queue', id)
}

// ── Core fetch wrapper ─────────────────────────────────────────────────────────
const BASE = '/api'

async function refreshAccessToken(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    if (!res.ok) return false
    const data = await res.json()
    setAccessToken(data.access_token, data.expires_in)
    return true
  } catch {
    return false
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  // Auto-refresh token if expired
  if (isTokenExpired() && accessToken !== null) {
    const ok = await refreshAccessToken()
    if (!ok) {
      clearAccessToken()
      window.dispatchEvent(new Event('auth:logout'))
      throw new Error('Session expired')
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })

  // Handle 401 — attempt one token refresh
  if (res.status === 401 && retry) {
    const ok = await refreshAccessToken()
    if (ok) return apiFetch<T>(path, options, false)
    clearAccessToken()
    window.dispatchEvent(new Event('auth:logout'))
    throw new Error('Not authenticated')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    // FastAPI 422 returns detail as array of validation errors
    let message: string
    if (Array.isArray(err.detail)) {
      message = err.detail.map((e: any) => `${e.loc?.slice(-1)[0]}: ${e.msg}`).join(', ')
    } else {
      message = err.detail || `HTTP ${res.status}`
    }
    throw new Error(message)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

// ── Reconnect sync ─────────────────────────────────────────────────────────────
export async function drainOfflineQueue(listId: string) {
  const queue = await getOfflineQueue()
  if (queue.length === 0) return

  console.log(`Draining ${queue.length} queued mutations for list ${listId}...`)

  for (const mutation of queue) {
    try {
      await apiFetch(mutation.url, {
        method: mutation.operation,
        body: JSON.stringify({ ...mutation.body, idempotency_key: mutation.idempotency_key }),
      })
      await clearMutationFromQueue(mutation.id)
    } catch (err) {
      console.error('Failed to replay mutation', mutation.id, err)
      // Continue with remaining — don't block the whole sync
    }
  }

  // Fetch server diff since last cursor
  const cursor = localStorage.getItem(`cursor:${listId}`)
  const since = cursor ? `?since=${cursor}` : ''
  try {
    const diff = await apiFetch<{ events: unknown[], server_cursor: string }>(
      `/lists/${listId}/items${since}`
    )
    localStorage.setItem(`cursor:${listId}`, new Date().toISOString())
    return diff
  } catch (err) {
    console.error('Failed to fetch diff', err)
  }
}

// ── Typed API methods ─────────────────────────────────────────────────────────

export const api = {
  auth: {
    register: (body: { email: string; password: string; name: string; grammatical_gender?: string }) =>
      apiFetch<{ access_token: string; expires_in: number }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
    login: (body: { email: string; password: string }) =>
      apiFetch<{ access_token: string; expires_in: number }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    me: () => apiFetch<{ id: string; email: string; name: string }>('/auth/me'),
    logout: () => apiFetch('/auth/logout', { method: 'POST' }),
  },

  households: {
    list: () => apiFetch<{ id: string; name: string; emoji: string }[]>('/households'),
    create: (body: { name: string; emoji?: string }) =>
      apiFetch<{ id: string }>('/households', { method: 'POST', body: JSON.stringify(body) }),
    members: (id: string) => apiFetch<unknown[]>(`/households/${id}/members`),
    invite: (id: string, body: { email: string; role?: string }) =>
      apiFetch(`/households/${id}/invite`, { method: 'POST', body: JSON.stringify(body) }),
  },

  catalog: {
    categories: () => apiFetch<unknown[]>('/catalog/categories'),
    search: (q: string, category?: string) =>
      apiFetch<{ items: unknown[]; total: number }>(`/catalog/items?q=${encodeURIComponent(q)}${category ? `&category=${category}` : ''}`),
    checkDuplicate: (name: string) =>
      apiFetch<{ duplicates: unknown[]; can_create: boolean }>(`/catalog/items/check-duplicate?name=${encodeURIComponent(name)}`),
    create: (body: { name_he: string; category_id: string; default_qty?: number; default_unit?: string; name_en?: string; barcode?: string }) =>
      apiFetch<{ id: string }>('/catalog/items', { method: 'POST', body: JSON.stringify(body) }),
    update: (itemId: string, body: { name_he?: string; name_en?: string; category_id?: string; default_qty?: number; default_unit?: string; barcode?: string }) =>
      apiFetch<unknown>(`/catalog/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (itemId: string) =>
      apiFetch<void>(`/catalog/items/${itemId}`, { method: 'DELETE' }),
    uploadImage: (itemId: string, file: File) => {
      const form = new FormData()
      form.append('file', file)
      return apiFetch<{ image_url: string }>(`/catalog/items/${itemId}/image`, {
        method: 'POST',
        headers: {},  // Let browser set Content-Type for multipart
        body: form,
      })
    },
  },

  lists: {
    list: (householdId?: string) =>
      apiFetch<unknown[]>(`/lists${householdId ? `?household_id=${householdId}` : ''}`),
    create: (body: { name: string; emoji?: string; household_id: string }) =>
      apiFetch<{ id: string }>('/lists', { method: 'POST', body: JSON.stringify(body) }),
    items: (listId: string, since?: string) =>
      apiFetch<unknown[]>(`/lists/${listId}/items${since ? `?since=${since}` : ''}`),
    addItem: (listId: string, body: { catalog_item_id: string; quantity: number; unit: string; note?: string; idempotency_key?: string }) =>
      apiFetch<{ id: string }>(`/lists/${listId}/items`, { method: 'POST', body: JSON.stringify(body) }),
    updateItem: (listId: string, itemId: string, body: { quantity?: number; unit?: string; note?: string }) =>
      apiFetch<unknown>(`/lists/${listId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    toggleStatus: (listId: string, itemId: string, body: { status: string; vector_clock?: Record<string, number>; idempotency_key?: string }) =>
      apiFetch(`/lists/${listId}/items/${itemId}/status`, { method: 'POST', body: JSON.stringify(body) }),
    deleteItem: (listId: string, itemId: string) =>
      apiFetch(`/lists/${listId}/items/${itemId}`, { method: 'DELETE' }),
    sync: (listId: string, mutations: unknown[], since?: string) =>
      apiFetch(`/lists/${listId}/sync${since ? `?since=${since}` : ''}`, {
        method: 'POST',
        body: JSON.stringify({ mutations }),
      }),
    invite: (listId: string, body: { user_id: string; role?: string }) =>
      apiFetch(`/lists/${listId}/members`, { method: 'POST', body: JSON.stringify(body) }),
  },

  recurring: {
    list: (householdId: string) => apiFetch<unknown[]>(`/households/${householdId}/recurring`),
    create: (householdId: string, body: unknown) =>
      apiFetch(`/households/${householdId}/recurring`, { method: 'POST', body: JSON.stringify(body) }),
    update: (householdId: string, id: string, body: unknown) =>
      apiFetch(`/households/${householdId}/recurring/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (householdId: string, id: string) =>
      apiFetch(`/households/${householdId}/recurring/${id}`, { method: 'DELETE' }),
  },

  push: {
    getVapidKey: () => apiFetch<{ key: string }>('/push/vapid-public-key'),
    subscribe: (body: { endpoint: string; p256dh: string; auth: string; device_hint?: string }) =>
      apiFetch('/push/subscriptions', { method: 'POST', body: JSON.stringify(body) }),
    unsubscribe: (endpoint: string) =>
      apiFetch(`/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`, { method: 'DELETE' }),
  },
}

// ── WebSocket client ───────────────────────────────────────────────────────────
export function createListWebSocket(
  listId: string,
  token: string,
  onEvent: (event: Record<string, unknown>) => void,
  cursor?: string,
): WebSocket {
  const params = new URLSearchParams({ token, ...(cursor ? { cursor } : {}) })
  const ws = new WebSocket(`/ws/lists/${listId}?${params}`)

  let pingInterval: ReturnType<typeof setInterval>

  ws.onopen = () => {
    console.log(`WS connected to list ${listId}`)
    // Send keepalive pings every 30s
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30_000)
  }

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'pong') return
      onEvent(msg)
    } catch {
      console.error('WS parse error', e.data)
    }
  }

  ws.onerror = (e) => console.error('WS error', e)

  ws.onclose = () => {
    clearInterval(pingInterval)
    console.log(`WS disconnected from list ${listId}`)
  }

  return ws
}

// ── Token accessor (for WebSocket auth in main.tsx) ────────────────────────────
export function getStoredToken(): string | null {
  return accessToken
}
