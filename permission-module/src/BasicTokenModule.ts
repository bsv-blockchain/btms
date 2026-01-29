import { CreateActionArgs, CreateActionResult, CreateSignatureArgs, Hash, LockingScript, PushDrop, Transaction, Utils } from '@bsv/sdk'
import { PermissionsModule } from '@bsv/wallet-toolbox-client'

// ---------------------------------------------------------------------------
// BTMS Permission Module Constants
// ---------------------------------------------------------------------------
// BRC-99: Baskets prefixed with "p " are permissioned and require wallet
// permission module support. The scheme ID is "btms".
//
// Token basket format: "p btms <assetId>"
// Example: "p btms abc123def456.0"
// ---------------------------------------------------------------------------

/** Permissioned basket prefix - aligns with btms-core */
const P_BASKET_PREFIX = 'p btms'

/** Index positions for BTMS PushDrop token fields */
const BTMS_FIELD = {
  ASSET_ID: 0,
  AMOUNT: 1,
  METADATA: 2
} as const

/**
 * Parsed information about a BTMS token from its locking script
 */
interface ParsedTokenInfo {
  assetId: string
  amount: number
  metadata?: {
    name?: string
    description?: string
    iconURL?: string
    [key: string]: unknown
  }
}

/**
 * Comprehensive token spend information extracted from createAction args
 */
interface TokenSpendInfo {
  /** Total amount being sent to recipient (not including change) */
  sendAmount: number
  /** Total amount being spent from inputs */
  totalInputAmount: number
  /** Change amount (totalInputAmount - sendAmount) */
  changeAmount: number
  /** Token name from metadata */
  tokenName: string
  /** Asset ID */
  assetId: string
  /** Recipient identity key (truncated) */
  recipient?: string
  /** Token icon URL if available */
  iconURL?: string
  /** Full action description */
  actionDescription: string
}

/**
 * Authorized transaction data captured from createAction response.
 * Used to verify createSignature calls are signing what was actually authorized.
 */
interface AuthorizedTransaction {
  /** The reference from the signable transaction */
  reference: string
  /** Hash of all outputs (BIP-143 hashOutputs) */
  hashOutputs: string
  /** Set of authorized outpoints (txid.vout format) */
  authorizedOutpoints: Set<string>
  /** Timestamp when this authorization was created */
  timestamp: number
}

/**
 * BasicTokenModule handles the "btms" (Basic Token Management Scheme) P-basket / p-protocol.
 * 
 * This module enforces permissions when spending btms tokens stored in
 * permissioned baskets (format: "p btms <assetId>").
 * 
 * The module intercepts:
 * - createAction: When outputs use P-baskets, extracts token info and prompts for spending permission
 * - createSignature: When signing with protocolID [0, 'p btms'], checks session authorization
 * - listOutputs: Allows viewing token balances in P-baskets
 * - internalizeAction: Allows receiving tokens into P-baskets
 * 
 * Authorization flow:
 * 1. createAction is called first - we extract token details and prompt user
 * 2. If approved, we store session authorization
 * 3. createSignature calls check session authorization (already approved in step 1)
 */
export class BasicTokenModule implements PermissionsModule {
  private readonly promptUserForTokenUsage: (app: string, message: string) => Promise<boolean>

  // Session-based authorization: tracks which originators have been approved for the current action
  // Key: originator, Value: timestamp of approval (expires after 60 seconds)
  private sessionAuthorizations: Map<string, number> = new Map()
  private readonly SESSION_TIMEOUT_MS = 60000 // 60 seconds

  // Security: Stores authorized transaction data from createAction responses
  // Key: originator, Value: authorized transaction details
  private authorizedTransactions: Map<string, AuthorizedTransaction> = new Map()

  constructor(
    promptUserForTokenUsage: (app: string, message: string) => Promise<boolean>
  ) {
    this.promptUserForTokenUsage = promptUserForTokenUsage
  }

  /**
   * Intercepts wallet method requests for P-basket/protocol operations.
   * 
   * - createAction: Extract token info from outputs and prompt for authorization
   * - createSignature: Check session authorization (should already be approved from createAction)
   */
  async onRequest(req: {
    method: string
    args: object
    originator: string
  }): Promise<{ args: object }> {
    const { method, args, originator } = req

    console.log('[BasicTokenModule] onRequest called:', { method, originator })

    if (method === 'createAction') {
      await this.handleCreateAction(args as CreateActionArgs, originator)
    } else if (method === 'createSignature') {
      await this.handleCreateSignature(args as CreateSignatureArgs, originator)
    }

    // For listOutputs, internalizeAction, relinquishOutput - just pass through
    // The WalletPermissionsManager already delegates these to us for P-baskets

    return { args }
  }

  /**
   * Transforms responses from the underlying wallet.
   * For createAction: Captures signable transaction data for security verification.
   */
  async onResponse(
    res: unknown,
    context: {
      method: string
      originator: string
    }
  ): Promise<unknown> {
    const { method, originator } = context

    if (method === 'createAction') {
      await this.captureAuthorizedTransaction(res as CreateActionResult, originator)
    }

    return res
  }

  /**
   * Captures authorized transaction data from createAction response.
   * This data is used to verify that createSignature calls are signing
   * what was actually authorized by the user.
   * 
   * Security measures:
   * 1. Store the reference to match against createSignature calls
   * 2. Compute and store hashOutputs to verify preimage integrity
   * 3. Whitelist the outpoints that are authorized to be signed
   */
  private async captureAuthorizedTransaction(
    result: CreateActionResult,
    originator: string
  ): Promise<void> {
    if (!result.signableTransaction) {
      console.log('[BasicTokenModule] No signable transaction in response, skipping capture')
      return
    }

    try {
      const { tx, reference } = result.signableTransaction
      const transaction = Transaction.fromAtomicBEEF(tx)

      // Compute hashOutputs (BIP-143 style) from the transaction outputs
      const hashOutputs = this.computeHashOutputs(transaction)

      // Collect all input outpoints as authorized
      const authorizedOutpoints = new Set<string>()
      for (const input of transaction.inputs) {
        const txid = input.sourceTXID || input.sourceTransaction?.id('hex')
        if (txid) {
          const outpoint = `${txid}.${input.sourceOutputIndex}`
          authorizedOutpoints.add(outpoint)
        }
      }

      // Store the authorized transaction data
      this.authorizedTransactions.set(originator, {
        reference,
        hashOutputs,
        authorizedOutpoints,
        timestamp: Date.now()
      })

      console.log('[BasicTokenModule] Captured authorized transaction:', {
        reference,
        hashOutputs,
        outpointCount: authorizedOutpoints.size,
        outpoints: Array.from(authorizedOutpoints)
      })
    } catch (error) {
      console.warn('[BasicTokenModule] Failed to capture authorized transaction:', error)
      // Don't throw - we'll fall back to session-based auth
    }
  }

  /**
   * Computes BIP-143 hashOutputs from a transaction.
   * This is the double-SHA256 of all outputs serialized.
   */
  private computeHashOutputs(tx: Transaction): string {
    // Serialize all outputs: satoshis (8 bytes LE) + scriptLen (varint) + script
    const outputBytes: number[] = []

    for (const output of tx.outputs) {
      // Satoshis as 8-byte little-endian
      const satoshis = output.satoshis ?? 0
      for (let i = 0; i < 8; i++) {
        outputBytes.push(Number((BigInt(satoshis) >> BigInt(i * 8)) & BigInt(0xff)))
      }

      // Script length as varint + script bytes
      const scriptBytes = output.lockingScript?.toBinary() ?? []
      const scriptLen = scriptBytes.length
      if (scriptLen < 0xfd) {
        outputBytes.push(scriptLen)
      } else if (scriptLen <= 0xffff) {
        outputBytes.push(0xfd)
        outputBytes.push(scriptLen & 0xff)
        outputBytes.push((scriptLen >> 8) & 0xff)
      } else {
        outputBytes.push(0xfe)
        outputBytes.push(scriptLen & 0xff)
        outputBytes.push((scriptLen >> 8) & 0xff)
        outputBytes.push((scriptLen >> 16) & 0xff)
        outputBytes.push((scriptLen >> 24) & 0xff)
      }
      outputBytes.push(...scriptBytes)
    }

    // Double SHA-256
    const hash = Hash.hash256(outputBytes)
    return Utils.toHex(hash)
  }

  /**
   * Handles createAction requests that involve BTMS P-baskets.
   * 
   * This is called when outputs use P-baskets (e.g., "p btms <assetId>").
   * We extract token information from the outputs and prompt for authorization.
   * 
   * @param args The createAction arguments
   * @param originator The app requesting the action
   */
  private async handleCreateAction(args: CreateActionArgs, originator: string): Promise<void> {
    console.log('[BasicTokenModule] handleCreateAction:', {
      description: args.description,
      inputCount: args.inputs?.length || 0,
      outputCount: args.outputs?.length || 0,
      originator
    })

    // If there are no inputs, this is likely token issuance - allow without prompt
    if (!args.inputs || args.inputs.length === 0) {
      console.log('[BasicTokenModule] No inputs - likely token issuance, allowing')
      this.grantSessionAuthorization(originator)
      return
    }

    // Extract comprehensive token spend info
    const spendInfo = this.extractTokenSpendInfo(args)
    console.log('[BasicTokenModule] Extracted spend info:', spendInfo)

    if (spendInfo.sendAmount > 0 || spendInfo.totalInputAmount > 0) {
      await this.promptForTokenSpend(originator, spendInfo)
    } else {
      // Can't determine amount, use generic prompt
      await this.promptForGenericAuthorization(originator)
    }
  }

  /**
   * Extracts comprehensive token spend information from createAction args.
   * 
   * Parses ALL output locking scripts to get token data, and extracts
   * recipient info from the action description.
   */
  private extractTokenSpendInfo(args: CreateActionArgs): TokenSpendInfo {
    let sendAmount = 0
    let changeAmount = 0
    let totalInputAmount = 0
    let tokenName = 'BTMS Token'
    let assetId = ''
    let iconURL: string | undefined
    let recipient: string | undefined

    console.log('[BasicTokenModule] extractTokenSpendInfo - args:', {
      description: args.description,
      inputCount: args.inputs?.length,
      outputCount: args.outputs?.length
    })

    // Parse action description for send amount and recipient (if not encrypted)
    // Format: "Send {amount} tokens to {recipient.slice(0, 8)}..."
    if (args.description) {
      console.log('[BasicTokenModule] Parsing description:', args.description)
      const sendMatch = args.description.match(/Send (\d+) tokens? to ([a-fA-F0-9]+)/i)
      if (sendMatch) {
        sendAmount = parseInt(sendMatch[1], 10)
        recipient = sendMatch[2]
        console.log('[BasicTokenModule] Matched description:', { sendAmount, recipient })
      }
    }

    // Parse input descriptions to get total input amount (if not encrypted)
    // Format: "Spend {amount} tokens"
    if (args.inputs) {
      for (const input of args.inputs) {
        console.log('[BasicTokenModule] Input:', { inputDescription: input.inputDescription })
        if (input.inputDescription) {
          const match = input.inputDescription.match(/Spend (\d+) tokens?/i)
          if (match) {
            totalInputAmount += parseInt(match[1], 10)
            console.log('[BasicTokenModule] Matched input amount:', match[1])
          }
        }
      }
    }

    // Parse ALL output locking scripts to extract token metadata
    if (args.outputs) {
      for (let i = 0; i < args.outputs.length; i++) {
        const output = args.outputs[i]
        console.log(`[BasicTokenModule] Output ${i}:`, {
          hasLockingScript: !!output.lockingScript,
          lockingScriptLen: output.lockingScript?.length,
          basket: output.basket,
          outputDescription: output.outputDescription
        })
        if (output.lockingScript) {
          const parsed = this.parseTokenLockingScript(output.lockingScript)
          console.log(`[BasicTokenModule] Parsed output ${i}:`, parsed)
          if (parsed) {
            // Get asset ID and metadata from first valid token
            if (!assetId && parsed.assetId && parsed.assetId !== 'ISSUE') {
              assetId = parsed.assetId
            }
            if (parsed.metadata?.name) {
              tokenName = parsed.metadata.name
            }
            if (parsed.metadata?.iconURL) {
              iconURL = parsed.metadata.iconURL
            }

            // Determine if this is a change output or send output
            // Prefer basket presence since descriptions may be encrypted
            if (output.basket?.startsWith(P_BASKET_PREFIX)) {
              changeAmount += parsed.amount
            } else {
              sendAmount += parsed.amount
            }
          }
        }
      }
    }

    // If we have token outputs, derive total input amount from them
    if (sendAmount + changeAmount > 0 && totalInputAmount === 0) {
      totalInputAmount = sendAmount + changeAmount
    }

    // If we still couldn't determine send amount, try calculating from inputs
    if (sendAmount === 0 && totalInputAmount > 0) {
      sendAmount = totalInputAmount - changeAmount
    }

    console.log('[BasicTokenModule] Final extracted info:', {
      sendAmount,
      totalInputAmount,
      changeAmount,
      tokenName,
      assetId,
      recipient
    })

    return {
      sendAmount,
      totalInputAmount,
      changeAmount,
      tokenName,
      assetId,
      recipient,
      iconURL,
      actionDescription: args.description || 'Token transaction'
    }
  }

  /**
   * Prompts user for token spend authorization with comprehensive details.
   */
  private async promptForTokenSpend(originator: string, spendInfo: TokenSpendInfo): Promise<void> {
    // Check for existing on-chain permission (disabled for now)
    // if (await this.hasValidPermission(originator)) {
    //   console.log('[BasicTokenModule] Valid on-chain permission found, allowing')
    //   this.grantSessionAuthorization(originator)
    //   return
    // }

    // Build a structured message for the prompt
    // Format: JSON-encoded spend info that TokenUsagePrompt can parse
    const promptData = {
      type: 'btms_spend',
      sendAmount: spendInfo.sendAmount,
      tokenName: spendInfo.tokenName,
      assetId: spendInfo.assetId,
      recipient: spendInfo.recipient,
      iconURL: spendInfo.iconURL,
      changeAmount: spendInfo.changeAmount,
      totalInputAmount: spendInfo.totalInputAmount
    }

    const message = JSON.stringify(promptData)
    console.log('[BasicTokenModule] Prompting user with spend info:', promptData)

    const approved = await this.promptUserForTokenUsage(originator, message)

    if (!approved) {
      console.log('[BasicTokenModule] User denied permission')
      throw new Error('Permission denied.')
    }

    console.log('[BasicTokenModule] User approved, granting session authorization')
    this.grantSessionAuthorization(originator)
  }

  /**
   * Prompts user for generic authorization when we can't determine token details.
   */
  private async promptForGenericAuthorization(originator: string): Promise<void> {
    // Prompt user
    const message = `Spend BTMS tokens\n\nApp: ${originator}`
    console.log('[BasicTokenModule] Prompting user (generic):', message)

    const approved = await this.promptUserForTokenUsage(originator, message)

    if (!approved) {
      console.log('[BasicTokenModule] User denied permission')
      throw new Error('User denied permission to spend BTMS tokens')
    }

    console.log('[BasicTokenModule] User approved, granting session authorization')
    this.grantSessionAuthorization(originator)
  }

  /**
   * Handles createSignature requests for BTMS token spending.
   * 
   * Security verification:
   * 1. Check session authorization from createAction approval
   * 2. Verify the preimage matches the authorized transaction (hashOutputs, outpoint)
   * 3. Fall back to on-chain permission check if no session auth
   * 
   * @param args The createSignature arguments
   * @param originator The app requesting the signature
   */
  private async handleCreateSignature(args: CreateSignatureArgs, originator: string): Promise<void> {
    console.log('[BasicTokenModule] handleCreateSignature:', {
      protocolID: args.protocolID,
      keyID: args.keyID,
      originator,
      hasData: !!args.data,
      dataLength: args.data?.length,
      hasSessionAuth: this.hasSessionAuthorization(originator),
      sessionAuthKeys: Array.from(this.sessionAuthorizations.keys())
    })

    // Check if we have session authorization from a recent createAction approval
    if (this.hasSessionAuthorization(originator)) {
      console.log('[BasicTokenModule] Session authorization found, allowing createSignature')
      // Session auth exists - skip prompting, just verify if we have transaction data
    } else {
      // No authorization found - this shouldn't happen if createAction was called first
      // But it can happen if createAction didn't go through our module (no P-basket outputs)
      console.warn('[BasicTokenModule] No authorization found for createSignature, prompting user')
      await this.promptForGenericAuthorization(originator)
    }

    // Session authorization exists - now verify the signature request matches
    // what was authorized in createAction
    const authorizedTx = this.authorizedTransactions.get(originator)
    if (!authorizedTx) {
      console.warn('[BasicTokenModule] No authorized transaction data found, allowing based on session auth')
      return
    }

    // Check if authorization has expired
    const elapsed = Date.now() - authorizedTx.timestamp
    if (elapsed > this.SESSION_TIMEOUT_MS) {
      this.authorizedTransactions.delete(originator)
      throw new Error('Authorized transaction has expired')
    }

    // Verify the preimage if data is provided (BIP-143 signing)
    if (args.data && args.data.length > 0) {
      this.verifyPreimage(args.data, authorizedTx, originator)
    }

    console.log('[BasicTokenModule] Signature request verified against authorized transaction')
  }

  /**
   * Verifies that a BIP-143 preimage matches the authorized transaction.
   * 
   * BIP-143 preimage structure:
   * - Version: 4 bytes
   * - hashPrevouts: 32 bytes
   * - hashSequence: 32 bytes
   * - Outpoint (txid + vout): 36 bytes
   * - scriptCode: variable (varint length + script)
   * - Value: 8 bytes
   * - Sequence: 4 bytes
   * - hashOutputs: 32 bytes
   * - Locktime: 4 bytes
   * - Sighash type: 4 bytes
   * 
   * We verify:
   * 1. The outpoint being signed is in our authorized list
   * 2. The hashOutputs matches what we computed from createAction
   */
  private verifyPreimage(data: number[], authorizedTx: AuthorizedTransaction, _originator: string): void {
    // Minimum preimage length: 4 + 32 + 32 + 36 + 1 + 8 + 4 + 32 + 4 + 4 = 157 bytes (with 1-byte script)
    if (data.length < 157) {
      console.warn('[BasicTokenModule] Preimage too short, skipping verification')
      return
    }

    try {
      // Extract outpoint (bytes 68-103: 32-byte txid reversed + 4-byte vout)
      const outpointStart = 4 + 32 + 32 // After version, hashPrevouts, hashSequence
      const txidBytes = data.slice(outpointStart, outpointStart + 32)
      // Reverse the txid bytes (Bitcoin uses little-endian)
      const txid = Utils.toHex(txidBytes.reverse())
      const voutBytes = data.slice(outpointStart + 32, outpointStart + 36)
      const vout = voutBytes[0] | (voutBytes[1] << 8) | (voutBytes[2] << 16) | (voutBytes[3] << 24)
      const outpoint = `${txid}.${vout}`

      console.log('[BasicTokenModule] Verifying outpoint:', outpoint)

      // Verify the outpoint is authorized
      if (!authorizedTx.authorizedOutpoints.has(outpoint)) {
        console.error('[BasicTokenModule] Outpoint not authorized:', outpoint)
        console.error('[BasicTokenModule] Authorized outpoints:', Array.from(authorizedTx.authorizedOutpoints))
        throw new Error(`Signature requested for unauthorized outpoint: ${outpoint}`)
      }

      // Find hashOutputs in the preimage
      // It's located after: version(4) + hashPrevouts(32) + hashSequence(32) + outpoint(36) + scriptCode(var) + value(8) + sequence(4)
      // We need to parse the scriptCode length first
      const scriptCodeLenStart = outpointStart + 36
      let scriptCodeLen: number
      let scriptCodeDataStart: number

      const firstByte = data[scriptCodeLenStart]
      if (firstByte < 0xfd) {
        scriptCodeLen = firstByte
        scriptCodeDataStart = scriptCodeLenStart + 1
      } else if (firstByte === 0xfd) {
        scriptCodeLen = data[scriptCodeLenStart + 1] | (data[scriptCodeLenStart + 2] << 8)
        scriptCodeDataStart = scriptCodeLenStart + 3
      } else if (firstByte === 0xfe) {
        scriptCodeLen = data[scriptCodeLenStart + 1] | (data[scriptCodeLenStart + 2] << 8) |
          (data[scriptCodeLenStart + 3] << 16) | (data[scriptCodeLenStart + 4] << 24)
        scriptCodeDataStart = scriptCodeLenStart + 5
      } else {
        console.warn('[BasicTokenModule] Unsupported varint size, skipping hashOutputs verification')
        return
      }

      // hashOutputs starts after scriptCode + value(8) + sequence(4)
      const hashOutputsStart = scriptCodeDataStart + scriptCodeLen + 8 + 4
      if (hashOutputsStart + 32 > data.length) {
        console.warn('[BasicTokenModule] Preimage too short for hashOutputs, skipping verification')
        return
      }

      const hashOutputsBytes = data.slice(hashOutputsStart, hashOutputsStart + 32)
      const preimageHashOutputs = Utils.toHex(hashOutputsBytes)

      console.log('[BasicTokenModule] Verifying hashOutputs:', {
        preimage: preimageHashOutputs,
        authorized: authorizedTx.hashOutputs
      })

      // Verify hashOutputs matches
      if (preimageHashOutputs !== authorizedTx.hashOutputs) {
        console.error('[BasicTokenModule] hashOutputs mismatch!')
        throw new Error('Signature preimage hashOutputs does not match authorized transaction')
      }

      console.log('[BasicTokenModule] Preimage verification passed')
    } catch (error) {
      if (error instanceof Error && error.message.includes('unauthorized')) {
        throw error
      }
      console.warn('[BasicTokenModule] Preimage verification error:', error)
      // Don't throw for parsing errors - fall back to session auth
    }
  }

  /**
   * Grants session authorization for an originator.
   */
  private grantSessionAuthorization(originator: string): void {
    this.sessionAuthorizations.set(originator, Date.now())
  }

  /**
   * Checks if an originator has valid session authorization.
   */
  private hasSessionAuthorization(originator: string): boolean {
    const timestamp = this.sessionAuthorizations.get(originator)
    if (!timestamp) return false

    const elapsed = Date.now() - timestamp
    if (elapsed > this.SESSION_TIMEOUT_MS) {
      this.sessionAuthorizations.delete(originator)
      return false
    }

    return true
  }


  /**
   * Parses a BTMS token locking script to extract token information.
   * 
   * BTMS tokens have 3-4 fields:
   * - Field 0: assetId (or "ISSUE")
   * - Field 1: amount (as string)
   * - Field 2: metadata (optional JSON string)
   * - Field 3: signature (always present in PushDrop)
   */
  private parseTokenLockingScript(lockingScriptHex: string): ParsedTokenInfo | null {
    try {
      const lockingScript = LockingScript.fromHex(lockingScriptHex)
      const decoded = PushDrop.decode(lockingScript)

      // BTMS tokens have 2-4 fields:
      // - Without signature: 2 fields (assetId, amount) or 3 fields (assetId, amount, metadata)
      // - With signature: 3 fields (assetId, amount, signature) or 4 fields (assetId, amount, metadata, signature)
      if (decoded.fields.length < 2 || decoded.fields.length > 4) {
        console.log('[BasicTokenModule] Invalid field count:', decoded.fields.length)
        return null
      }

      const assetId = Utils.toUTF8(decoded.fields[BTMS_FIELD.ASSET_ID])
      const amount = Number(Utils.toUTF8(decoded.fields[BTMS_FIELD.AMOUNT]))

      console.log('[BasicTokenModule] Parsed token:', { assetId, amount, fieldCount: decoded.fields.length })

      if (isNaN(amount) || amount <= 0) {
        console.log('[BasicTokenModule] Invalid amount:', amount)
        return null
      }

      // Try to parse metadata from field 2 if it exists and looks like JSON
      let metadata: ParsedTokenInfo['metadata']
      if (decoded.fields.length >= 3) {
        try {
          const potentialMetadata = Utils.toUTF8(decoded.fields[BTMS_FIELD.METADATA])
          // Only parse if it looks like JSON (starts with {)
          if (potentialMetadata.startsWith('{')) {
            metadata = JSON.parse(potentialMetadata)
            console.log('[BasicTokenModule] Parsed metadata:', metadata)
          }
        } catch (e) {
          // Field 2 might be a signature, not metadata - that's fine
          console.log('[BasicTokenModule] Field 2 is not JSON metadata')
        }
      }

      return { assetId, amount, metadata }
    } catch (e) {
      console.log('[BasicTokenModule] Failed to parse locking script:', e)
      return null
    }
  }

}
