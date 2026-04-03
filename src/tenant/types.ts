export interface TenantRecord {
  tenantId: string
  walletId: "primary"
  walletAddressBase58: string
  walletAddressHex: string
  walletDir: string
  createdAt: number
  updatedAt: number
  sessionVersion: number
}

export interface TenantIndex {
  [walletAddressHex: string]: string
}

export interface TenantAuthContext {
  tenant: TenantRecord
}
