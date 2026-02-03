// frontend/src/btms/index.ts
//
// BTMS Frontend Wrapper
// ---------------------
// This module wraps @bsv/btms-core to provide a simple interface for the UI.
// It handles initialization, asset change notifications, and MessageBoxClient integration.

import { BTMS as BTMSCore, BTMSAsset, IncomingToken as CoreIncomingPayment, CommsLayer, IncomingToken } from '@bsv/btms-core'
import { WalletClient, PubKeyHex } from '@bsv/sdk'
import { MessageBoxClient } from '@bsv/message-box-client'

// Re-export types for UI components
export type { BTMSAsset, CoreIncomingPayment }

// Asset type expected by UI components
export interface Asset {
  assetId: string
  name?: string
  balance: number
  metadata?: string
  hasPendingIncoming?: boolean
  incoming?: boolean
  incomingAmount?: number
}

// Asset change callback type
type AssetsChangedCallback = (assets: Asset[]) => void

/**
 * Adapter to make MessageBoxClient compatible with CommsLayer interface.
 */
function createCommsAdapter(messageBoxClient: MessageBoxClient): CommsLayer {
  return {
    async sendMessage(args: { recipient: PubKeyHex; messageBox: string; body: string }): Promise<string> {
      const result = await messageBoxClient.sendMessage(args)
      return result.messageId
    },

    async listMessages(args: { messageBox: string }): Promise<Array<{ messageId: string; sender: PubKeyHex; body: string }>> {
      const messages = await messageBoxClient.listMessages({ messageBox: args.messageBox })
      return messages.map(m => ({
        messageId: m.messageId,
        sender: m.sender as PubKeyHex,
        body: typeof m.body === 'string' ? m.body : JSON.stringify(m.body)
      }))
    },

    async acknowledgeMessage(args: { messageIds: string[] }): Promise<void> {
      await messageBoxClient.acknowledgeMessage(args)
    }
  }
}

/**
 * Frontend BTMS wrapper that provides a simple interface for the UI.
 * Wraps @bsv/btms-core with MessageBoxClient for token delivery.
 */
class BTMSFrontend {
  private core: BTMSCore
  private assetsChangedCallbacks: AssetsChangedCallback[] = []
  private cachedAssets: Asset[] = []

  constructor() {
    // Initialize with WalletClient and MessageBoxClient
    const wallet = new WalletClient()
    const messageBoxClient = new MessageBoxClient()
    const comms = createCommsAdapter(messageBoxClient)

    this.core = new BTMSCore({
      wallet,
      comms,
      networkPreset: 'local'
    })
  }

  /**
   * Register a callback to be notified when assets change.
   */
  onAssetsChanged(callback: AssetsChangedCallback): void {
    this.assetsChangedCallbacks.push(callback)
    // Immediately call with cached assets if available
    if (this.cachedAssets.length > 0) {
      callback(this.cachedAssets)
    }
  }

  /**
   * Notify all registered callbacks of asset changes.
   */
  private notifyAssetsChanged(assets: Asset[]): void {
    this.cachedAssets = assets
    for (const callback of this.assetsChangedCallbacks) {
      callback(assets)
    }
  }

  /**
   * List all assets owned by the user.
   */
  async listAssets(): Promise<Asset[]> {
    const coreAssets = await this.core.listAssets()
    const assets: Asset[] = coreAssets.map(a => ({
      assetId: a.assetId,
      name: a.name,
      balance: a.balance,
      metadata: a.metadata ? JSON.stringify(a.metadata) : undefined,
      hasPendingIncoming: a.hasPendingIncoming,
      incoming: a.hasPendingIncoming,
      incomingAmount: 0 // Will be populated by listIncomingPayments
    }))

    this.notifyAssetsChanged(assets)
    return assets
  }

  /**
   * Issue new tokens.
   * 
   * @param amount - Number of tokens to issue
   * @param name - Token name (for display)
   * @param symbol - Token symbol (unused, kept for API compatibility)
   * @param metadataJson - JSON string with additional metadata
   */
  async issue(
    amount: number,
    name: string,
    _symbol?: string,
    metadataJson?: string
  ): Promise<{ txid: string; assetId: string }> {
    // Parse metadata if provided
    let metadata: Record<string, any> = { name }
    if (metadataJson) {
      try {
        const parsed = JSON.parse(metadataJson)
        metadata = { ...metadata, ...parsed }
      } catch {
        // Keep just the name if JSON parsing fails
      }
    }

    const result = await this.core.issue(amount, metadata)

    if (!result.success) {
      throw new Error(result.error || 'Failed to issue tokens')
    }

    // Refresh assets after issuance
    await this.listAssets()

    return {
      txid: result.txid,
      assetId: result.assetId
    }
  }

  /**
   * Send tokens to a recipient.
   * 
   * @param assetId - Asset ID to send
   * @param recipient - Recipient's identity public key
   * @param amount - Amount to send
   */
  async send(
    assetId: string,
    recipient: string,
    amount: number
  ): Promise<{ txid: string; success: boolean }> {
    const result = await this.core.send(assetId, recipient, amount)

    if (!result.success) {
      throw new Error(result.error || 'Failed to send tokens')
    }

    // Refresh assets after sending
    await this.listAssets()

    return {
      txid: result.txid,
      success: true
    }
  }

  /**
   * Burn tokens to remove them from circulation.
   * 
   * @param assetId - Asset ID to burn
   * @param amount - Amount to burn (optional, defaults to entire balance)
   */
  async burn(
    assetId: string,
    amount?: number
  ): Promise<{ txid: string; success: boolean; amountMelted: number }> {
    const result = await this.core.burn(assetId, amount)

    if (!result.success) {
      throw new Error(result.error || 'Failed to burn tokens')
    }

    // Refresh assets after burning
    await this.listAssets()

    return {
      txid: result.txid,
      success: true,
      amountMelted: result.amountMelted
    }
  }

  /**
   * Relinquish corrupted or invalid BTMS outputs from the basket.
   * Useful when a UTXO is not on the overlay and cannot be spent.
   */
  async relinquishBadOutputs(): Promise<{
    relinquished: string[]
    failed: Array<{ outpoint: string; error: string }>
  }> {
    return (this.core as any).relinquishBadOutputs()
  }

  /**
   * List incoming token payments.
   * 
   * @param assetId - Optional filter by asset ID
   */
  async listIncomingPayments(assetId?: string): Promise<IncomingToken[]> {
    const incoming = await this.core.listIncoming(assetId)
    return incoming.map(p => ({
      txid: p.txid,
      outputIndex: p.outputIndex,
      lockingScript: p.lockingScript,
      amount: p.amount,
      assetId: p.assetId,
      sender: p.sender,
      satoshis: p.satoshis,
      messageId: p.messageId,
      customInstructions: p.customInstructions,
      beef: p.beef as number[] | undefined
    }))
  }

  /**
   * Accept an incoming token payment.
   * 
   * @param assetId - Asset ID (unused, kept for API compatibility)
   * @param payment - The incoming payment to accept
   */
  async acceptIncomingPayment(
    _assetId: string,
    payment: IncomingToken
  ): Promise<boolean> {
    const result = await this.core.accept({
      txid: payment.txid as any,
      outputIndex: payment.outputIndex,
      lockingScript: payment.lockingScript as any,
      amount: payment.amount,
      satoshis: payment.satoshis,
      assetId: payment.assetId,
      sender: payment.sender as any,
      messageId: payment.messageId,
      customInstructions: payment.customInstructions as any,
      beef: payment.beef as any
    })

    if (!result.success) {
      throw new Error(result.error || 'Failed to accept payment')
    }

    // Refresh assets after accepting
    await this.listAssets()

    return true
  }

  /**
   * Get balance for a specific asset.
   * 
   * @param assetId - Asset ID to check
   */
  async getBalance(assetId: string): Promise<number> {
    return this.core.getBalance(assetId)
  }

  /**
   * Get transaction history for an asset.
   * 
   * @param assetId - Asset ID to query
   * @param limit - Maximum number of transactions to return
   * @param offset - Number of transactions to skip (for pagination)
   */
  async getTransactions(
    assetId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ transactions: any[]; total: number }> {
    const result = await this.core.getTransactions(assetId, limit, offset)

    // Transform to match frontend expected format
    const transactions = result.transactions.map(tx => ({
      date: tx.timestamp ? new Date(tx.timestamp).toLocaleString() : 'Unknown',
      amount: tx.amount,
      txid: tx.txid,
      counterparty: tx.counterparty || 'N/A',
      type: tx.type,
      direction: tx.direction,
      status: tx.status,
      timestamp: tx.timestamp
    }))

    return {
      transactions,
      total: result.total
    }
  }

  /**
   * Get the user's identity key.
   */
  async getIdentityKey(): Promise<string> {
    return this.core.getIdentityKey()
  }

  /**
   * Refund an incoming payment (send it back to sender).
   * Note: This is a placeholder - full refund functionality requires additional implementation.
   */
  async refundIncomingTransaction(
    _assetId: string,
    _payment: IncomingToken
  ): Promise<{ success: boolean }> {
    // Refund would require creating a new transaction sending tokens back to sender
    // For now, just acknowledge the message to remove it from inbox
    throw new Error('Refund functionality not yet implemented')
  }
}

// Create singleton instance
export const btms = new BTMSFrontend()

// Export wallet client for App.tsx identity checking
export const walletClient = new WalletClient()
