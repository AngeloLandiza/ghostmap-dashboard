/**
 * Who may rename or delete a map (PLAN section 1: "writes require ownership").
 *
 * The backend is the authority — it answers 403 if we get this wrong — this only decides
 * whether the buttons are worth showing.
 */
import type { MapRecord } from '../../lib/api/types'

export interface MapAccessPrincipal {
  isAdmin: boolean
  userId: string | null
}

export function canManageMap(map: MapRecord | null | undefined, principal: MapAccessPrincipal): boolean {
  if (!map) return false
  if (principal.isAdmin) return true
  const owner = map.ownerUserId
  return Boolean(owner && principal.userId && owner === principal.userId)
}

/** Human label for the owner column: the account name, else the account, else the phone. */
export function ownerLabel(map: MapRecord): string {
  if (map.ownerName) return map.ownerName
  if (map.ownerUserId) return `user ${map.ownerUserId.slice(0, 8)}`
  if (map.deviceId) return `device ${map.deviceId.slice(0, 8)}`
  return 'Unclaimed'
}
