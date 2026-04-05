// ── Auth ──────────────────────────────────────────────────────────────────────
export interface User {
  id: string
  email: string
  name: string
  avatar_url: string | null
  grammatical_gender: 'm' | 'f' | 'neutral'
  created_at: string
}

export interface TokenResponse {
  access_token: string
  expires_in: number
}

// ── Households ────────────────────────────────────────────────────────────────
export interface Household {
  id: string
  name: string
  emoji: string
  owner_id: string
  created_at: string
}

export interface HouseholdMember {
  user_id: string
  name: string
  email: string
  avatar_url: string | null
  role: 'owner' | 'admin' | 'member'
  joined_at: string
}

// ── Catalog ───────────────────────────────────────────────────────────────────
export interface CatalogCategory {
  id: string
  name_he: string
  name_en: string
  icon: string
  sort_order: number
}

export interface CatalogItem {
  id: string
  name_he: string
  name_en: string | null
  category_id: string
  image_url: string | null
  default_qty: number
  default_unit: string
  barcode: string | null
  usage_count: number
}

// ── Shopping Lists ────────────────────────────────────────────────────────────
export interface ShoppingList {
  id: string
  name: string
  emoji: string
  status: 'active' | 'archived' | 'completed'
  household_id: string
  created_by: string
  created_at: string
  completed_at: string | null
  member_count: number
  pending_count: number
}

export interface ListMember {
  user_id: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  notification_prefs: Record<string, boolean>
}

export interface ListItem {
  id: string
  list_id: string
  catalog_item_id: string
  catalog_item: CatalogItem
  quantity: number
  unit: string
  note: string | null
  status: 'pending' | 'purchased'
  added_by: string | null
  purchased_by: string | null
  vector_clock: Record<string, number>
  created_at: string
  updated_at: string
}

// ── Recurring ─────────────────────────────────────────────────────────────────
export interface RecurringItem {
  id: string
  household_id: string
  catalog_item_id: string
  catalog_item: CatalogItem
  target_list_id: string | null
  quantity: number
  unit: string
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom'
  interval_days: number
  next_run_date: string
  auto_add: boolean
  is_enabled: boolean
  created_at: string
}

// ── WebSocket events ──────────────────────────────────────────────────────────
export type WsEvent =
  | { type: 'item_added';         item_id: string; catalog_item_id: string; quantity: string; unit: string; added_by: string; added_by_name: string }
  | { type: 'item_status_changed'; item_id: string; status: 'pending' | 'purchased'; by_user: string; by_name: string }
  | { type: 'item_deleted';        item_id: string; by_user: string }
  | { type: 'presence_update';     user_id: string; event?: 'joined' | 'left'; status?: string }
  | { type: 'replay';              events: WsEvent[] }

// ── UI helpers ────────────────────────────────────────────────────────────────
export type Screen = 'list' | 'shopping' | 'recurring' | 'catalog'

export interface ToastData {
  id: string
  msg: string
  action?: () => void
}
