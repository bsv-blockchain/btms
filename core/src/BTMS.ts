/**
 * BTMS - Basic Token Management System
 * 
 * Main class for managing BTMS tokens. Provides high-level methods for:
 * - Issuing new tokens
 * - Sending tokens to recipients
 * - Receiving tokens from others
 * - Querying token balances and assets
 * 
 */

import {
  WalletClient,
  Transaction,
  Beef,
  Utils,
  TopicBroadcaster,
  LookupResolver,
  LockingScript,
  CreateActionArgs,
  CreateActionOutput,
  ListOutputsResult,
  ListActionsResult,
  TXIDHexString,
  HexString,
  PubKeyHex,
  OutpointString,
  LabelStringUnder300Bytes,
  OutputTagStringUnder300Bytes,
  PositiveIntegerOrZero
} from '@bsv/sdk'

import { BTMSToken } from './BTMSToken.js'
import type {
  BTMSConfig,
  ResolvedBTMSConfig,
  BTMSAsset,
  BTMSAssetMetadata,
  BTMSTokenOutput,
  IssueResult,
  SendResult,
  AcceptResult,
  TokenForRecipient,
  IncomingPayment,
  OwnershipProof,
  ProvenToken,
  ProveOwnershipResult,
  VerifyOwnershipResult
} from './types.js'
import {
  BTMS_TOPIC,
  BTMS_LOOKUP_SERVICE,
  BTMS_PROTOCOL_ID,
  BTMS_KEY_ID,
  BTMS_LABEL,
  BTMS_BASKET_PREFIX,
  DEFAULT_TOKEN_SATOSHIS,
  ISSUE_MARKER,
  getAssetBasket
} from './constants.js'

/**
 * BTMS - Basic Token Management System
 * 
 * @example
 * ```typescript
 * // Create a BTMS instance
 * const btms = new BTMS()
 * 
 * // Issue new tokens
 * const result = await btms.issue('GOLD', 1000, { description: 'A test token' })
 * console.log('Asset ID:', result.assetId)
 * 
 * // Check balance
 * const balance = await btms.getBalance(result.assetId)
 * console.log('Balance:', balance)
 * 
 * // Send tokens
 * await btms.send(result.assetId, recipientPubKey, 100)
 * 
 * // List all assets
 * const assets = await btms.listAssets()
 * ```
 */
export class BTMS {
  private config: ResolvedBTMSConfig
  private tokenTemplate: BTMSToken
  private cachedIdentityKey?: PubKeyHex
  private originator?: string

  constructor(config: BTMSConfig = {}) {
    this.config = this.resolveConfig(config)
    this.tokenTemplate = new BTMSToken(
      this.config.wallet,
      this.config.protocolID,
      this.config.keyID
    )
  }

  /**
   * Set the originator for wallet calls.
   * This is passed through to all wallet operations.
   */
  setOriginator(originator: string): void {
    this.originator = originator
  }

  // ---------------------------------------------------------------------------
  // Token Issuance
  // ---------------------------------------------------------------------------

  /**
   * Issue new BTMS tokens.
   * 
   * Creates a new token with the specified amount and optional metadata.
   * The token will be stored in basket 'p btms <assetId>' where assetId is
   * the canonical txid.0 format determined after transaction creation.
   * 
   * @param amount - Number of tokens to issue (positive integer)
   * @param metadata - Optional metadata including name, description, iconURL, etc.
   * @returns Issue result with txid and assetId
   * 
   * @example
   * ```typescript
   * const result = await btms.issue(1000000, {
   *   name: 'GOLD',
   *   description: 'Represents 1 gram of gold',
   *   iconURL: 'https://example.com/gold.png'
   * })
   * console.log('Asset ID:', result.assetId) // e.g., 'abc123...def.0'
   * ```
   */
  async issue(amount: number, metadata?: BTMSAssetMetadata): Promise<IssueResult> {
    try {
      // Create the issuance locking script
      const lockingScript = await this.tokenTemplate.createIssuance(amount, metadata)
      const lockingScriptHex = lockingScript.toHex()

      const tokenName = metadata?.name ?? 'tokens'

      // Build the action WITHOUT a basket - we'll internalize after to use the real assetId
      const args: CreateActionArgs = {
        description: `Issue ${amount} ${tokenName}`,
        labels: [BTMS_LABEL as LabelStringUnder300Bytes],
        outputs: [
          {
            satoshis: this.config.tokenSatoshis,
            lockingScript: lockingScriptHex,
            outputDescription: `Issue ${amount} ${tokenName}`,
            tags: ['btms_issue'] as OutputTagStringUnder300Bytes[]
          }
        ],
        options: {
          acceptDelayedBroadcast: false,
          randomizeOutputs: false
        }
      }

      // Create the action (no basket yet)
      const createResult = await this.config.wallet.createAction(args, this.originator)

      if (!createResult.tx || !createResult.txid) {
        throw new Error('Transaction creation failed - no tx returned')
      }

      // Get the txid to compute the canonical assetId
      const assetId = BTMSToken.computeAssetId(createResult.txid, 0)

      // Now internalize the action into the correct basket using the real assetId
      const basket = getAssetBasket(assetId)
      await this.config.wallet.internalizeAction({
        tx: createResult.tx,
        outputs: [{
          outputIndex: 0 as PositiveIntegerOrZero,
          protocol: 'basket insertion',
          insertionRemittance: { basket }
        }],
        labels: [BTMS_LABEL],
        description: `Issue ${amount} ${tokenName}`
      }, this.originator)

      // Broadcast to overlay
      const broadcaster = new TopicBroadcaster([BTMS_TOPIC], {
        networkPreset: this.config.networkPreset
      })
      const broadcastResult = await broadcaster.broadcast(Transaction.fromAtomicBEEF(createResult.tx))

      if (broadcastResult.status !== 'success') {
        throw new Error(`Broadcast failed: ${(broadcastResult as any).description || 'Unknown error'}`)
      }

      return {
        success: true,
        txid: createResult.txid,
        assetId,
        outputIndex: 0,
        amount
      }
    } catch (error) {
      return {
        success: false,
        txid: '' as TXIDHexString,
        assetId: '',
        outputIndex: 0,
        amount,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Token Transfers
  // ---------------------------------------------------------------------------

  /**
   * Send tokens to a recipient.
   * 
   * Selects UTXOs to cover the amount, creates transfer outputs,
   * and broadcasts the transaction. If a messenger is configured,
   * also sends the token data to the recipient.
   * 
   * @param assetId - The asset to send
   * @param recipient - Recipient's identity public key
   * @param amount - Amount to send
   * @returns Send result with transaction details
   */
  async send(assetId: string, recipient: PubKeyHex, amount: number): Promise<SendResult> {
    try {
      // Validate inputs
      if (!BTMSToken.isValidAssetId(assetId)) {
        throw new Error(`Invalid assetId: ${assetId}`)
      }
      if (amount < 1 || !Number.isInteger(amount)) {
        throw new Error('Amount must be a positive integer')
      }

      // Get sender identity
      const senderKey = await this.getIdentityKey()

      // Fetch spendable UTXOs for this asset
      const utxos = await this.getSpendableTokens(assetId)

      if (utxos.length === 0) {
        throw new Error(`No spendable tokens found for asset ${assetId}`)
      }

      // Select UTXOs to cover the amount (greedy: largest first)
      const { selected, totalInput } = BTMS.selectUTXOs(utxos, amount)

      if (totalInput < amount) {
        throw new Error(`Insufficient balance. Have ${totalInput}, need ${amount}`)
      }

      // Get metadata from first selected UTXO (must be consistent)
      const metadata = selected[0].token.metadata

      // Build BEEF from selected UTXOs
      const beefResult = await this.config.wallet.listOutputs({
        basket: getAssetBasket(assetId),
        include: 'entire transactions',
        limit: 1000
      }, this.originator)

      if (!beefResult.BEEF) {
        throw new Error('Failed to get BEEF for token UTXOs')
      }

      const beefObj = Beef.fromBinary(Utils.toArray(beefResult.BEEF))

      // Determine if sending to self
      const isSendingToSelf = senderKey === recipient

      // Build outputs
      const outputs: CreateActionOutput[] = []
      const basket = getAssetBasket(assetId)

      // Recipient output
      const recipientScript = await this.tokenTemplate.createTransfer(
        assetId,
        amount,
        metadata,
        isSendingToSelf ? 'self' : recipient
      )
      const recipientScriptHex = recipientScript.toHex() as HexString

      outputs.push({
        satoshis: this.config.tokenSatoshis,
        lockingScript: recipientScriptHex,
        outputDescription: `Send ${amount} tokens`,
        tags: ['btms_transfer'] as OutputTagStringUnder300Bytes[],
        ...(isSendingToSelf ? { basket } : {})
      })

      // Change output (if needed)
      const changeAmount = totalInput - amount
      if (changeAmount > 0) {
        const changeScript = await this.tokenTemplate.createTransfer(
          assetId,
          changeAmount,
          metadata,
          'self'
        )

        outputs.push({
          satoshis: this.config.tokenSatoshis,
          lockingScript: changeScript.toHex(),
          basket,
          outputDescription: `Change: ${changeAmount} tokens`,
          tags: ['btms_change'] as OutputTagStringUnder300Bytes[]
        })
      }

      // Build inputs
      const inputs = selected.map(u => ({
        outpoint: u.outpoint as OutpointString,
        unlockingScriptLength: 74,
        inputDescription: `Spend ${u.token.amount} tokens`
      }))

      // Create the action
      const createArgs: CreateActionArgs = {
        description: `Send ${amount} tokens to ${recipient.slice(0, 8)}...`,
        labels: [BTMS_LABEL as LabelStringUnder300Bytes],
        inputBEEF: beefObj.toBinary(),
        inputs,
        outputs,
        options: {
          acceptDelayedBroadcast: false,
          randomizeOutputs: false
        }
      }

      const { signableTransaction } = await this.config.wallet.createAction(createArgs, this.originator)

      if (!signableTransaction) {
        throw new Error('Failed to create signable transaction')
      }

      // Sign all inputs
      const txForSigning = Transaction.fromAtomicBEEF(signableTransaction.tx)
      const unlocker = this.tokenTemplate.createUnlocker('self')

      const spends: Record<number, { unlockingScript: string }> = {}
      for (let i = 0; i < selected.length; i++) {
        const unlockingScript = await unlocker.sign(txForSigning, i)
        spends[i] = { unlockingScript: unlockingScript.toHex() }
      }

      // Sign the action
      const signResult = await this.config.wallet.signAction({
        reference: signableTransaction.reference,
        spends
      }, this.originator)

      if (!signResult.tx) {
        throw new Error('Failed to sign transaction')
      }

      const finalTx = Transaction.fromAtomicBEEF(signResult.tx)
      const txid = finalTx.id('hex') as TXIDHexString

      // Broadcast to overlay
      const broadcaster = new TopicBroadcaster([BTMS_TOPIC], {
        networkPreset: this.config.networkPreset
      })
      const broadcastResult = await broadcaster.broadcast(finalTx)

      if (broadcastResult.status !== 'success') {
        throw new Error(`Broadcast failed: ${(broadcastResult as any).description || 'Unknown error'}`)
      }

      // Build token data for recipient
      const tokenForRecipient: TokenForRecipient = {
        txid,
        outputIndex: 0,
        lockingScript: recipientScriptHex,
        amount,
        satoshis: this.config.tokenSatoshis,
        beef: signResult.tx,
        keyID: this.config.keyID,
        assetId,
        metadata
      }

      // Send to recipient via comms layer (if configured and not sending to self)
      if (this.config.comms && !isSendingToSelf) {
        const body = JSON.stringify(tokenForRecipient)
        await this.config.comms.sendMessage({
          recipient,
          messageBox: this.config.messageBox,
          body
        })
      }

      return {
        success: true,
        txid,
        tokenForRecipient,
        changeAmount: changeAmount > 0 ? changeAmount : undefined
      }
    } catch (error) {
      return {
        success: false,
        txid: '' as TXIDHexString,
        tokenForRecipient: {} as TokenForRecipient,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Receiving Tokens
  // ---------------------------------------------------------------------------

  /**
   * List incoming token payments (requires comms layer).
   * 
   * @param assetId - Optional filter by asset ID
   * @returns List of incoming payments
   */
  async listIncoming(assetId?: string): Promise<IncomingPayment[]> {
    if (!this.config.comms) {
      return []
    }

    const messages = await this.config.comms.listMessages({
      messageBox: this.config.messageBox
    })

    const payments: IncomingPayment[] = []
    for (const msg of messages) {
      try {
        const payment = JSON.parse(msg.body) as IncomingPayment
        payment.messageId = msg.messageId
        payment.sender = msg.sender

        // Filter by assetId if provided
        if (!assetId || payment.assetId === assetId) {
          payments.push(payment)
        }
      } catch {
        // Skip invalid messages
      }
    }

    return payments
  }

  /**
   * Accept an incoming token payment.
   * 
   * Verifies the token on the overlay, internalizes it into the wallet,
   * and acknowledges receipt via the messenger.
   * 
   * @param payment - The incoming payment to accept
   * @returns Accept result
   */
  async accept(payment: IncomingPayment): Promise<AcceptResult> {
    try {
      // Decode and validate the token
      const decoded = BTMSToken.decode(payment.lockingScript)
      if (!decoded.valid) {
        throw new Error(`Invalid token: ${decoded.error}`)
      }

      // Verify the token exists on the overlay
      const resolver = new LookupResolver({ networkPreset: this.config.networkPreset })

      let isOnOverlay = false
      try {
        const lookupResult = await resolver.query({
          service: BTMS_LOOKUP_SERVICE,
          query: { txid: payment.txid, outputIndex: payment.outputIndex }
        })
        isOnOverlay = lookupResult.type === 'output-list' && lookupResult.outputs.length > 0
      } catch {
        // Token not found, try to re-broadcast
      }

      // Re-broadcast if not on overlay
      if (!isOnOverlay && payment.beef) {
        const tx = Transaction.fromBEEF(payment.beef)
        const broadcaster = new TopicBroadcaster([BTMS_TOPIC], {
          networkPreset: this.config.networkPreset
        })
        await broadcaster.broadcast(tx)
      }

      // Internalize the token into the wallet
      const basket = getAssetBasket(payment.assetId)

      await this.config.wallet.internalizeAction({
        tx: payment.beef,
        labels: [BTMS_LABEL],
        outputs: [
          {
            outputIndex: payment.outputIndex as PositiveIntegerOrZero,
            protocol: 'basket insertion',
            insertionRemittance: { basket }
          }
        ],
        description: `Receive ${payment.amount} tokens`,
        seekPermission: true
      }, this.originator)

      // Acknowledge receipt via comms layer
      if (this.config.comms && payment.messageId) {
        await this.config.comms.acknowledgeMessage({
          messageIds: [payment.messageId]
        })
      }

      return {
        success: true,
        assetId: payment.assetId,
        amount: payment.amount
      }
    } catch (error) {
      return {
        success: false,
        assetId: payment.assetId,
        amount: payment.amount,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Balance and Asset Queries
  // ---------------------------------------------------------------------------

  /**
   * Get the balance of a specific asset.
   * 
   * @param assetId - The asset to check
   * @returns Total spendable balance
   */
  async getBalance(assetId: string): Promise<number> {
    const utxos = await this.getSpendableTokens(assetId)
    return utxos.reduce((sum, u) => sum + u.token.amount, 0)
  }

  /**
   * List all assets owned by this wallet.
   * 
   * @returns List of assets with balances
   */
  async listAssets(): Promise<BTMSAsset[]> {
    const assetIds = new Set<string>()

    // Discover assets via listActions with 'btms' label
    try {
      const actionsResult: ListActionsResult = await this.config.wallet.listActions({
        labels: [BTMS_LABEL],
        includeOutputs: true,
        limit: 10000
      }, this.originator)

      const basketPrefix = BTMS_BASKET_PREFIX + ' '
      for (const action of actionsResult.actions) {
        for (const output of action.outputs ?? []) {
          if (output.basket?.startsWith(basketPrefix)) {
            const assetId = output.basket.substring(basketPrefix.length)
            if (assetId && assetId !== ISSUE_MARKER && BTMSToken.isValidAssetId(assetId)) {
              assetIds.add(assetId)
            }
          }
        }
      }
    } catch {
      // Ignore errors in discovery
    }

    // Also check incoming payments
    if (this.config.comms) {
      try {
        const incoming = await this.config.comms.listMessages({
          messageBox: this.config.messageBox
        })

        for (const msg of incoming) {
          try {
            const payment = JSON.parse(msg.body) as IncomingPayment
            payment.messageId = msg.messageId
            payment.sender = msg.sender

            // Filter by assetId if provided
            if (BTMSToken.isValidAssetId(payment.assetId)) {
              assetIds.add(payment.assetId)
            }
          } catch {
            // Skip invalid messages
          }
        }
      } catch {
        // Ignore comms errors
      }
    }

    // Build asset list with balances
    const assets: BTMSAsset[] = []

    for (const assetId of assetIds) {
      const balance = await this.getBalance(assetId)
      const utxos = await this.getSpendableTokens(assetId)

      // Extract metadata from first UTXO
      let metadata: BTMSAssetMetadata | undefined
      if (utxos.length > 0 && utxos[0].token.metadata) {
        try {
          metadata = JSON.parse(utxos[0].token.metadata)
        } catch {
          // Invalid metadata
        }
      }

      // Check for pending incoming
      let hasPendingIncoming = false
      if (this.config.comms) {
        const incoming = await this.listIncoming(assetId)
        hasPendingIncoming = incoming.length > 0
      }

      // Only include assets with balance or pending incoming
      if (balance > 0 || hasPendingIncoming) {
        assets.push({
          assetId,
          name: metadata?.name,
          balance,
          metadata,
          hasPendingIncoming
        })
      }
    }

    return assets
  }

  /**
   * Get all spendable token UTXOs for an asset.
   * 
   * @param assetId - The asset to query
   * @returns List of spendable token outputs
   */
  async getSpendableTokens(assetId: string): Promise<BTMSTokenOutput[]> {
    const basket = getAssetBasket(assetId)

    const result: ListOutputsResult = await this.config.wallet.listOutputs({
      basket,
      include: 'locking scripts',
      includeTags: true,
      limit: 10000
    }, this.originator)

    const tokens: BTMSTokenOutput[] = []

    for (const output of result.outputs) {
      if (!output.spendable) continue
      if (output.satoshis !== this.config.tokenSatoshis) continue

      const scriptHex = (output as any).lockingScript
      if (!scriptHex) continue

      const decoded = BTMSToken.decode(scriptHex)
      if (!decoded.valid) continue

      // For transfer outputs, verify the assetId matches
      if (decoded.assetId !== ISSUE_MARKER && decoded.assetId !== assetId) continue

      const [txid, outputIndexStr] = output.outpoint.split('.')
      const outputIndex = Number(outputIndexStr)

      tokens.push({
        outpoint: output.outpoint,
        txid: txid as TXIDHexString,
        outputIndex,
        satoshis: output.satoshis,
        lockingScript: scriptHex as HexString,
        token: decoded,
        spendable: true
      })
    }

    return tokens
  }

  // ---------------------------------------------------------------------------
  // Ownership Proof Methods
  // ---------------------------------------------------------------------------

  /**
   * Prove ownership of tokens to a verifier.
   * 
   * Creates a cryptographic proof that the caller owns the specified tokens
   * by revealing key linkage information that only the owner could produce.
   * 
   * @param assetId - The asset to prove ownership of
   * @param amount - The amount to prove (must have sufficient balance)
   * @param verifier - The verifier's identity public key
   * @returns Ownership proof that can be verified by the verifier
   * 
   * @example
   * ```typescript
   * const proof = await btms.proveOwnership('abc123.0', 100, verifierPubKey)
   * // Send proof to verifier for verification
   * ```
   */
  async proveOwnership(
    assetId: string,
    amount: number,
    verifier: PubKeyHex
  ): Promise<ProveOwnershipResult> {
    try {
      // Validate inputs
      if (!BTMSToken.isValidAssetId(assetId)) {
        throw new Error(`Invalid assetId: ${assetId}`)
      }
      if (amount < 1 || !Number.isInteger(amount)) {
        throw new Error('Amount must be a positive integer')
      }

      // Get prover's identity key
      const prover = await this.getIdentityKey()

      // Get spendable tokens for this asset
      const utxos = await this.getSpendableTokens(assetId)
      if (utxos.length === 0) {
        throw new Error(`No tokens found for asset ${assetId}`)
      }

      // Select tokens to cover the amount
      const { selected, totalInput } = BTMS.selectUTXOs(utxos, amount)
      if (totalInput < amount) {
        throw new Error(`Insufficient balance. Have ${totalInput}, need ${amount}`)
      }

      // Generate key linkage proofs for each selected token
      const provenTokens: ProvenToken[] = []

      for (const utxo of selected) {
        // Reveal specific key linkage for this token
        // The counterparty is 'self' for tokens we own (resolved to our own key)
        const linkageResult = await this.config.wallet.revealSpecificKeyLinkage({
          counterparty: prover, // Self-owned tokens use our own key as counterparty
          verifier,
          protocolID: this.config.protocolID,
          keyID: this.config.keyID
        }, this.originator)

        provenTokens.push({
          output: {
            txid: utxo.txid,
            outputIndex: utxo.outputIndex,
            lockingScript: utxo.lockingScript,
            satoshis: utxo.satoshis
          },
          linkage: {
            prover: linkageResult.prover as PubKeyHex,
            verifier: linkageResult.verifier as PubKeyHex,
            counterparty: linkageResult.counterparty as PubKeyHex,
            encryptedLinkage: linkageResult.encryptedLinkage,
            encryptedLinkageProof: linkageResult.encryptedLinkageProof,
            proofType: linkageResult.proofType
          }
        })
      }

      const proof: OwnershipProof = {
        prover,
        verifier,
        tokens: provenTokens,
        amount,
        assetId
      }

      return {
        success: true,
        proof
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Verify an ownership proof from a prover.
   * 
   * Validates that:
   * 1. The key linkage is valid for each token
   * 2. The tokens exist on the overlay
   * 3. The total amount matches the claimed amount
   * 4. All tokens belong to the claimed prover
   * 
   * @param proof - The ownership proof to verify
   * @returns Verification result
   * 
   * @example
   * ```typescript
   * const result = await btms.verifyOwnership(proof)
   * if (result.valid) {
   *   console.log(`Verified ${result.amount} tokens owned by ${result.prover}`)
   * }
   * ```
   */
  async verifyOwnership(proof: OwnershipProof): Promise<VerifyOwnershipResult> {
    try {
      // Get verifier's identity key
      const verifierKey = await this.getIdentityKey()

      // Verify the proof is intended for us
      if (proof.verifier !== verifierKey) {
        throw new Error('Proof is not intended for this verifier')
      }

      let amountProven = 0

      // Verify each token in the proof
      for (const provenToken of proof.tokens) {
        // Decode the token to get the amount
        const decoded = BTMSToken.decode(provenToken.output.lockingScript)
        if (!decoded.valid) {
          throw new Error('Invalid token in proof')
        }

        // Verify the token belongs to the claimed asset
        const tokenAssetId = decoded.assetId === ISSUE_MARKER
          ? BTMSToken.computeAssetId(provenToken.output.txid, provenToken.output.outputIndex)
          : decoded.assetId

        if (tokenAssetId !== proof.assetId) {
          throw new Error('Token asset ID does not match proof asset ID')
        }

        // Verify the linkage prover matches the proof prover
        if (provenToken.linkage.prover !== proof.prover) {
          throw new Error('Token linkage prover does not match proof prover')
        }

        // Decrypt the linkage to verify the prover owns the key
        // The verifier decrypts using their key and the prover as counterparty
        const { plaintext: linkage } = await this.config.wallet.decrypt({
          ciphertext: provenToken.linkage.encryptedLinkage,
          protocolID: [
            2,
            `specific linkage revelation ${this.config.protocolID[0]} ${this.config.protocolID[1]}`
          ],
          keyID: this.config.keyID,
          counterparty: proof.prover
        }, this.originator)

        // The linkage should be a valid HMAC - if decryption succeeded,
        // it proves the prover has the corresponding private key
        if (!linkage || linkage.length === 0) {
          throw new Error('Invalid key linkage for token')
        }

        // Verify the token exists on the overlay
        const lookupResult = await this.lookupTokenOnOverlay(
          provenToken.output.txid,
          provenToken.output.outputIndex
        )
        if (!lookupResult.found) {
          throw new Error('Token not found on overlay')
        }

        // Add to proven amount
        amountProven += decoded.amount
      }

      // Verify the total amount matches
      if (amountProven < proof.amount) {
        throw new Error(`Amount proven (${amountProven}) is less than claimed (${proof.amount})`)
      }

      return {
        valid: true,
        amount: amountProven,
        assetId: proof.assetId,
        prover: proof.prover
      }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Lookup a token on the overlay to verify it exists.
   * 
   * @param txid - Transaction ID
   * @param outputIndex - Output index
   * @returns Whether the token was found
   */
  private async lookupTokenOnOverlay(
    txid: TXIDHexString,
    outputIndex: number
  ): Promise<{ found: boolean }> {
    try {
      const lookup = new LookupResolver({ networkPreset: this.config.networkPreset })
      const result = await lookup.query({
        service: BTMS_LOOKUP_SERVICE,
        query: { txid, outputIndex }
      })

      // Check if we got a valid result
      if (result && result.outputs && result.outputs.length > 0) {
        return { found: true }
      }
      return { found: false }
    } catch {
      return { found: false }
    }
  }

  // ---------------------------------------------------------------------------
  // Utility Methods
  // ---------------------------------------------------------------------------

  /**
   * Get the wallet's identity public key (cached after first call).
   */
  async getIdentityKey(): Promise<PubKeyHex> {
    if (!this.cachedIdentityKey) {
      const { publicKey } = await this.config.wallet.getPublicKey({
        identityKey: true
      }, this.originator)
      this.cachedIdentityKey = publicKey as PubKeyHex
    }
    return this.cachedIdentityKey
  }

  /**
   * Decode a token from a locking script.
   */
  decodeToken(lockingScript: string | LockingScript) {
    return BTMSToken.decode(lockingScript)
  }

  // ---------------------------------------------------------------------------
  // Static Methods
  // ---------------------------------------------------------------------------

  /**
   * Select UTXOs to cover a target amount using a greedy algorithm.
   * 
   * Sorts UTXOs by amount descending (largest first) and selects
   * until the total meets or exceeds the target amount.
   * 
   * @param utxos - Available UTXOs to select from
   * @param amount - Target amount to cover
   * @returns Selected UTXOs and total input amount
   */
  static selectUTXOs<T extends { token: { amount: number } }>(
    utxos: T[],
    amount: number
  ): { selected: T[]; totalInput: number } {
    // Sort by amount descending (largest first)
    const sorted = [...utxos].sort((a, b) => b.token.amount - a.token.amount)
    const selected: T[] = []
    let totalInput = 0

    for (const utxo of sorted) {
      if (totalInput >= amount) break
      selected.push(utxo)
      totalInput += utxo.token.amount
    }

    return { selected, totalInput }
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private resolveConfig(config: BTMSConfig): ResolvedBTMSConfig {
    return {
      wallet: config.wallet ?? new WalletClient(),
      networkPreset: config.networkPreset ?? 'mainnet',
      overlayHosts: config.overlayHosts ?? [],
      tokenSatoshis: config.tokenSatoshis ?? DEFAULT_TOKEN_SATOSHIS,
      protocolID: config.protocolID ?? BTMS_PROTOCOL_ID,
      keyID: config.keyID ?? BTMS_KEY_ID,
      comms: config.comms,
      messageBox: config.messageBox ?? 'btms_tokens'
    }
  }
}
