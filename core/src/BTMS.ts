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
  PositiveIntegerOrZero,
  Random
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
  IncomingToken,
  OwnershipProof,
  ProvenToken,
  ProveOwnershipResult,
  VerifyOwnershipResult,
  SelectionOptions,
  SelectionResult
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
      this.config.keyID,
      this.originator
    )
  }

  /**
   * Set the originator for wallet calls.
   * This is passed through to all wallet operations.
   */
  setOriginator(originator: string): void {
    this.originator = originator
    // Recreate token template with new originator
    this.tokenTemplate = new BTMSToken(
      this.config.wallet,
      this.config.protocolID,
      this.config.keyID,
      this.originator
    )
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
      // Generate random derivation keys for privacy
      const derivationPrefix = Utils.toBase64(Random(32))
      const derivationSuffix = Utils.toBase64(Random(32))
      const keyID = `${derivationPrefix} ${derivationSuffix}`

      // Create the issuance locking script
      const lockingScript = await this.tokenTemplate.createIssuance(amount, keyID, metadata)
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
            customInstructions: JSON.stringify({
              derivationPrefix,
              derivationSuffix
            }),
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
          insertionRemittance: {
            basket,
            customInstructions: JSON.stringify({
              derivationPrefix,
              derivationSuffix
            }),
            tags: ['btms_issue'] as OutputTagStringUnder300Bytes[]
          }
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
      const { tokens: utxos } = await this.getSpendableTokens(assetId)

      if (utxos.length === 0) {
        throw new Error(`No spendable tokens found for asset ${assetId}`)
      }

      // Select and verify UTXOs on the overlay
      const { selected, totalInput, inputBeef } = await this.selectAndVerifyUTXOs(utxos, amount)

      if (totalInput < amount) {
        throw new Error(`Insufficient balance on overlay. Have ${totalInput}, need ${amount}`)
      }

      // Get metadata from first selected UTXO (must be consistent)
      const metadata = selected[0].token.metadata

      // Determine if sending to self
      const isSendingToSelf = senderKey === recipient

      // Build outputs
      const outputs: CreateActionOutput[] = []
      const basket = getAssetBasket(assetId)

      // Generate random derivation for recipient output
      const paymentDerivationPrefix = Utils.toBase64(Random(32))
      const recipientDerivationSuffix = Utils.toBase64(Random(32))
      const recipientKeyID = `${paymentDerivationPrefix} ${recipientDerivationSuffix}`

      // Recipient output
      const recipientScript = await this.tokenTemplate.createTransfer(
        assetId,
        amount,
        recipientKeyID,
        isSendingToSelf ? 'self' : recipient,
        metadata
      )
      const recipientScriptHex = recipientScript.toHex() as HexString

      outputs.push({
        satoshis: this.config.tokenSatoshis,
        lockingScript: recipientScriptHex,
        customInstructions: JSON.stringify({
          derivationPrefix: paymentDerivationPrefix,
          derivationSuffix: recipientDerivationSuffix
        }),
        outputDescription: `Send ${amount} tokens`,
        tags: ['btms_transfer'] as OutputTagStringUnder300Bytes[],
        ...(isSendingToSelf ? { basket } : {})
      })

      // Change output (if needed)
      const changeAmount = totalInput - amount
      if (changeAmount > 0) {
        // Generate random derivation for change output
        const changeDerivationSuffix = Utils.toBase64(Random(32))
        const changeKeyID = `${paymentDerivationPrefix} ${changeDerivationSuffix}`

        const changeScript = await this.tokenTemplate.createTransfer(
          assetId,
          changeAmount,
          changeKeyID,
          'self',
          metadata
        )

        outputs.push({
          satoshis: this.config.tokenSatoshis,
          lockingScript: changeScript.toHex(),
          customInstructions: JSON.stringify({
            derivationPrefix: paymentDerivationPrefix,
            derivationSuffix: changeDerivationSuffix
          }),
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

      // Create the action with BEEF from overlay
      const createArgs: CreateActionArgs = {
        description: `Send ${amount} tokens to ${recipient.slice(0, 8)}...`,
        labels: [BTMS_LABEL as LabelStringUnder300Bytes],
        inputBEEF: inputBeef.toBinary(),
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

      // Sign all inputs with their respective keyIDs
      const txForSigning = Transaction.fromAtomicBEEF(signableTransaction.tx)

      const spends: Record<number, { unlockingScript: string }> = {}
      for (let i = 0; i < selected.length; i++) {
        const utxo = selected[i]

        // Extract keyID from customInstructions
        let keyID: string | undefined
        if (utxo.customInstructions) {
          try {
            const instructions = JSON.parse(utxo.customInstructions)
            if (instructions.derivationPrefix && instructions.derivationSuffix) {
              keyID = `${instructions.derivationPrefix} ${instructions.derivationSuffix}`
            }
          } catch {
            // Invalid customInstructions, will attempt to use default keyID
          }
        }

        const unlocker = this.tokenTemplate.createUnlocker('self', keyID)
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
        customInstructions: JSON.stringify({
          derivationPrefix: paymentDerivationPrefix,
          derivationSuffix: recipientDerivationSuffix
        }),
        assetId,
        metadata
      }

      // Send to recipient via comms layer (if configured and not sending to self)
      if (this.config.comms && !isSendingToSelf) {
        await this.config.comms.sendMessage({
          recipient,
          messageBox: this.config.messageBox,
          body: JSON.stringify(tokenForRecipient)
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
  async listIncoming(assetId?: string): Promise<IncomingToken[]> {
    if (!this.config.comms) {
      return []
    }

    const messages = await this.config.comms.listMessages({
      messageBox: this.config.messageBox
    })

    const payments: IncomingToken[] = []
    for (const msg of messages) {
      try {
        const payment = JSON.parse(msg.body) as IncomingToken
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
   * Accept an incoming token.
   * 
   * Verifies the token on the overlay, internalizes it into the wallet,
   * and acknowledges receipt via the messenger.
   * 
   * @param token - The incoming token to accept
   * @returns Accept result
   */
  async accept(token: IncomingToken): Promise<AcceptResult> {
    try {
      // Decode and validate the token
      const decoded = BTMSToken.decode(token.lockingScript)
      if (!decoded.valid) {
        throw new Error(`Invalid token: ${decoded.error}`)
      }

      // Verify the token exists on the overlay
      const { found: isOnOverlay } = await this.lookupTokenOnOverlay(token.txid, token.outputIndex)

      // Re-broadcast if token is not on overlay
      if (!isOnOverlay && token.beef) {
        const tx = Transaction.fromBEEF(token.beef)
        const broadcaster = new TopicBroadcaster([BTMS_TOPIC], {
          networkPreset: this.config.networkPreset
        })
        const response = await broadcaster.broadcast(tx)
        if (response.status !== 'success') {
          throw new Error('Token not found on overlay and broadcast failed!')
        }
      }

      // Internalize the token into the wallet
      const basket = getAssetBasket(token.assetId)

      await this.config.wallet.internalizeAction({
        tx: token.beef,
        labels: [BTMS_LABEL],
        outputs: [
          {
            outputIndex: token.outputIndex as PositiveIntegerOrZero,
            protocol: 'basket insertion',
            insertionRemittance: {
              basket,
              customInstructions: token.customInstructions,
              tags: ['btms_received'] as OutputTagStringUnder300Bytes[]
            }
          }
        ],
        description: `Receive ${token.amount} tokens`,
        seekPermission: true
      }, this.originator)

      // Acknowledge receipt via comms layer
      if (this.config.comms && token.messageId) {
        await this.config.comms.acknowledgeMessage({
          messageIds: [token.messageId]
        })
      }

      return {
        success: true,
        assetId: token.assetId,
        amount: token.amount
      }
    } catch (error) {
      return {
        success: false,
        assetId: token.assetId,
        amount: token.amount,
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
    const { tokens: utxos } = await this.getSpendableTokens(assetId)
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
      debugger

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

    // Get all incoming payments once (used for both discovery and per-asset checks)
    const allIncoming: IncomingToken[] = []
    if (this.config.comms) {
      try {
        const messages = await this.config.comms.listMessages({
          messageBox: this.config.messageBox
        })
        for (const msg of messages) {
          try {
            const payment = JSON.parse(msg.body) as IncomingToken
            payment.messageId = msg.messageId
            payment.sender = msg.sender
            allIncoming.push(payment)
            // Also add to discovered assets
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
      // Single call to get UTXOs (used for both balance and metadata)
      const { tokens: utxos } = await this.getSpendableTokens(assetId)
      const balance = utxos.reduce((sum, u) => sum + u.token.amount, 0)

      // Extract metadata from first UTXO
      let metadata: BTMSAssetMetadata | undefined
      if (utxos.length > 0 && utxos[0].token.metadata) {
        try {
          metadata = JSON.parse(utxos[0].token.metadata)
        } catch {
          // Invalid metadata
        }
      }

      // Check for pending incoming (filter from already-fetched list)
      const incomingForAsset = allIncoming.filter(p => p.assetId === assetId)
      const hasPendingIncoming = incomingForAsset.length > 0

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
   * @param includeBeef - Whether to include full transaction data (for spending)
   * @returns List of spendable token outputs and optional BEEF
   */
  async getSpendableTokens(
    assetId: string,
    includeBeef = false
  ): Promise<{ tokens: BTMSTokenOutput[], beef?: Beef }> {
    const basket = getAssetBasket(assetId)

    const result: ListOutputsResult = await this.config.wallet.listOutputs({
      basket,
      include: includeBeef ? 'entire transactions' : 'locking scripts',
      includeTags: true,
      includeCustomInstructions: true,
      limit: 10000
    }, this.originator)

    const tokens: BTMSTokenOutput[] = []

    console.log('[BTMS] getSpendableTokens basket:', basket, 'found', result.outputs.length, 'outputs')

    for (const output of result.outputs) {
      console.log('[BTMS] checking output:', output.outpoint, 'spendable:', output.spendable, 'satoshis:', output.satoshis)
      if (!output.spendable) continue
      if (output.satoshis !== this.config.tokenSatoshis) continue

      const scriptHex = (output as any).lockingScript
      if (!scriptHex) {
        console.log('[BTMS] no lockingScript')
        continue
      }

      const decoded = BTMSToken.decode(scriptHex)
      console.log('[BTMS] decode result:', decoded.valid ? 'valid' : decoded.error)
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
        customInstructions: output.customInstructions,
        token: decoded,
        spendable: true
      })
    }

    const beef = includeBeef && result.BEEF ? Beef.fromBinary(Utils.toArray(result.BEEF)) : undefined
    return { tokens, beef }
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
      const { tokens: utxos } = await this.getSpendableTokens(assetId)
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
   * @param includeBeef - Whether to return BEEF data
   * @returns Whether the token was found and optionally the BEEF
   */
  private async lookupTokenOnOverlay(
    txid: TXIDHexString,
    outputIndex: number,
    includeBeef = false
  ): Promise<{ found: boolean; beef?: Beef }> {
    try {
      const lookup = new LookupResolver({ networkPreset: this.config.networkPreset })
      const result = await lookup.query({
        service: BTMS_LOOKUP_SERVICE,
        query: { txid, outputIndex }
      })

      // Check if we got a valid result
      if (result.type === 'output-list' && result.outputs.length > 0) {
        const beef = includeBeef ? Beef.fromBinary(result.outputs[0].beef) : undefined
        return { found: true, beef }
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

  /**
   * Select and verify UTXOs on the overlay.
   * 
   * Selects UTXOs first using the specified strategy, then verifies only
   * the selected ones on the overlay. If any fail verification, retries
   * with remaining UTXOs.
   * 
   * @param utxos - Available UTXOs to select from
   * @param amount - Target amount to cover
   * @param options - Selection options including strategy
   * @returns Selected UTXOs, total input, and merged BEEF from overlay
   */
  async selectAndVerifyUTXOs(
    utxos: BTMSTokenOutput[],
    amount: number,
    options: SelectionOptions = {}
  ): Promise<{ selected: BTMSTokenOutput[]; totalInput: number; inputBeef: Beef }> {
    const inputBeef = new Beef()
    let remainingUtxos = [...utxos]

    while (remainingUtxos.length > 0) {
      // Select UTXOs using the specified strategy
      const { selected, totalInput } = BTMS.selectUTXOs(remainingUtxos, amount, options)

      if (selected.length === 0 || totalInput < amount) {
        // Not enough UTXOs available
        return { selected: [], totalInput: 0, inputBeef }
      }

      // Verify only the selected UTXOs on overlay
      const verificationPromises = selected.map(async (utxo) => {
        const { found, beef } = await this.lookupTokenOnOverlay(utxo.txid, utxo.outputIndex, true)
        return { utxo, found, beef }
      })

      const verificationResults = await Promise.all(verificationPromises)

      // Separate valid and invalid UTXOs
      const validResults = verificationResults.filter(r => r.found)
      const invalidUtxos = verificationResults.filter(r => !r.found).map(r => r.utxo)

      // Merge BEEF from valid UTXOs
      for (const result of validResults) {
        if (result.beef) {
          inputBeef.mergeBeef(result.beef)
        }
      }

      // If all selected UTXOs are valid, we're done
      if (invalidUtxos.length === 0) {
        return {
          selected: validResults.map(r => r.utxo),
          totalInput,
          inputBeef
        }
      }

      // Some UTXOs failed verification - remove them and retry
      remainingUtxos = remainingUtxos.filter(
        u => !invalidUtxos.some(invalid => invalid.outpoint === u.outpoint)
      )
    }

    // Token supply exhausted
    return { selected: [], totalInput: 0, inputBeef }
  }

  // ---------------------------------------------------------------------------
  // Static Methods
  // ---------------------------------------------------------------------------

  /**
   * Select UTXOs to cover a target amount using a configurable strategy.
   * 
   * @param utxos - Available UTXOs to select from
   * @param amount - Target amount to cover
   * @param options - Selection options including strategy
   * @returns Selected UTXOs, total input amount, and excluded UTXOs
   */
  static selectUTXOs<T extends { token: { amount: number } }>(
    utxos: T[],
    amount: number,
    options: SelectionOptions = {}
  ): SelectionResult<T> {
    const {
      strategy = 'largest-first',
      fallbackStrategy = 'largest-first',
      maxInputs,
      minUtxoAmount = 0
    } = options

    // Filter by minimum amount
    const eligible = utxos.filter(u => u.token.amount >= minUtxoAmount)
    const excluded = utxos.filter(u => u.token.amount < minUtxoAmount)

    // Sort based on strategy
    let sorted: T[]
    switch (strategy) {
      case 'smallest-first':
        sorted = [...eligible].sort((a, b) => a.token.amount - b.token.amount)
        break
      case 'random':
        sorted = [...eligible].sort(() => Math.random() - 0.5)
        break
      case 'exact-match':
        // Try to find exact match first
        const exactMatch = eligible.find(u => u.token.amount === amount)
        if (exactMatch) {
          return { selected: [exactMatch], totalInput: amount, excluded }
        }
        // Fall back to configured strategy
        switch (fallbackStrategy) {
          case 'smallest-first':
            sorted = [...eligible].sort((a, b) => a.token.amount - b.token.amount)
            break
          case 'random':
            sorted = [...eligible].sort(() => Math.random() - 0.5)
            break
          case 'largest-first':
          default:
            sorted = [...eligible].sort((a, b) => b.token.amount - a.token.amount)
            break
        }
        break
      case 'largest-first':
      default:
        sorted = [...eligible].sort((a, b) => b.token.amount - a.token.amount)
        break
    }

    // Select UTXOs until we meet the target
    const selected: T[] = []
    let totalInput = 0

    for (const utxo of sorted) {
      if (totalInput >= amount) break
      if (maxInputs !== undefined && selected.length >= maxInputs) break
      selected.push(utxo)
      totalInput += utxo.token.amount
    }

    return { selected, totalInput, excluded }
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
