import { CreateSignatureArgs, LockingScript, PushDrop, Utils, WalletInterface } from '@bsv/sdk'
import { PermissionsModule } from '@bsv/wallet-toolbox-client'

// ---------------------------------------------------------------------------
// BTMS Permission Module Constants
// ---------------------------------------------------------------------------
// BRC-99: Baskets prefixed with "p " are permissioned and require wallet
// permission module support. The scheme ID is "btms".
//
// Token basket format: "p btms <assetId>"
// Example: "p btms MyToken123"
// ---------------------------------------------------------------------------

/** Permission scheme ID for BTMS (BRC-99 compliant) */
const BTMS_SCHEME_ID = 'btms'

/** Permissioned basket prefix - aligns with btms-core */
const P_BASKET_PREFIX = `p ${BTMS_SCHEME_ID}`

/**
 * BasicTokenModule handles the "btms" (Basic Token Management Scheme) P-basket / p-protocol.
 * 
 * This module enforces permissions when spending btms tokens stored in
 * permissioned baskets (format: "p btms <assetId>").
 * 
 * When createSignature is called for a btms protocolID, it prompts the user
 * for permission to spend those assets.
 */
export class BasicTokenModule implements PermissionsModule {
  private readonly wallet: WalletInterface
  private readonly adminOriginator: string
  private readonly promptUserForTokenUsage: (app: string, message: string) => Promise<boolean>

  constructor(
    wallet: WalletInterface,
    adminOriginator: string,
    promptUserForTokenUsage: (app: string, message: string) => Promise<boolean>
  ) {
    this.wallet = wallet
    this.adminOriginator = adminOriginator
    this.promptUserForTokenUsage = promptUserForTokenUsage
  }

  async onRequest(req: {
    method: string
    args: object
    originator: string
  }): Promise<{ args: object }> {
    const { method, args, originator } = req

    console.log('[BasicTokenModule] onRequest called:', { method, originator })

    if (method === 'createSignature') {
      await this.handleCreateSignature(args as CreateSignatureArgs, originator)
    }

    return { args }
  }

  async onResponse(
    res: any,
    context: {
      method: string
      originator: string
    }
  ): Promise<any> {
    // BasicTokenModule doesn't transform responses
    return res
  }

  /**
   * Parses concatenated BTMS fields from dataToSign bytes.
   * 
   * BTMS tokens have 4 fields concatenated: assetId + amount + op + metadata
   * - assetId: Token identifier (e.g., "MyToken")
   * - amount: Numeric quantity as string (e.g., "100")
   * - op: Operation type ("ISSUE" or "TRANSFER")
   * - metadata: JSON string starting with '{'
   * 
   * @param dataToSign The concatenated byte array to parse
   * @returns Parsed fields or null if parsing fails
   */
  private parseBTMSFields(dataToSign: Uint8Array | number[]): { assetId: string; amount: string; op: string; metadata: string } | null {
    try {
      const data = dataToSign instanceof Uint8Array ? Array.from(dataToSign) : dataToSign
      const fullString = new TextDecoder().decode(new Uint8Array(data))

      // Find where metadata starts by looking for '{'
      const metadataStart = fullString.indexOf('{')
      if (metadataStart === -1) {
        console.warn('[BasicTokenModule] No JSON metadata found in dataToSign')
        return null
      }

      const metadata = fullString.slice(metadataStart)
      const beforeMetadata = fullString.slice(0, metadataStart)

      // The op field is either "ISSUE" or "TRANSFER" - find it
      let op: string
      let beforeOp: string

      if (beforeMetadata.endsWith('TRANSFER')) {
        op = 'TRANSFER'
        beforeOp = beforeMetadata.slice(0, -8) // Remove "TRANSFER"
      } else if (beforeMetadata.endsWith('ISSUE')) {
        op = 'ISSUE'
        beforeOp = beforeMetadata.slice(0, -5) // Remove "ISSUE"
      } else {
        console.warn('[BasicTokenModule] No valid op field found:', beforeMetadata)
        return null
      }

      // Now beforeOp contains: assetId + amount
      // Find where amount starts by working backwards through digits
      let amountStart = beforeOp.length
      for (let i = beforeOp.length - 1; i >= 0; i--) {
        if (beforeOp[i] >= '0' && beforeOp[i] <= '9') {
          amountStart = i
        } else {
          break
        }
      }

      if (amountStart >= beforeOp.length) {
        console.warn('[BasicTokenModule] No amount found in:', beforeOp)
        return null
      }

      const assetId = beforeOp.slice(0, amountStart)
      const amount = beforeOp.slice(amountStart)

      console.log('[BasicTokenModule] Parsed BTMS fields:', { assetId, amount, op, metadata: metadata.slice(0, 50) + '...' })

      return { assetId, amount, op, metadata }
    } catch (error) {
      console.warn('[BasicTokenModule] Failed to parse BTMS fields:', error)
      return null
    }
  }

  /**
   * Handles createSignature requests for BTMS tokens.
   * Validates token availability and ensures proper authorization before signing.
   * 
   * @param args The createSignature arguments containing dataToSign
   * @param originator The app requesting the signature
   */
  private async handleCreateSignature(args: CreateSignatureArgs, originator: string): Promise<void> {
    if (!args.data || args.data.length === 0) {
      return
    }

    const parsedFields = this.parseBTMSFields(args.data)
    if (!parsedFields) {
      return
    }

    // Allow token issuance without permission check (op field is "ISSUE")
    if (parsedFields.op === 'ISSUE') {
      console.log('[BasicTokenModule] Allowing ISSUE operation without permission check')
      return
    }

    // Parse metadata for display purposes
    let metadata: any = {}
    try {
      metadata = JSON.parse(parsedFields.metadata)
    } catch {
      metadata = { raw: parsedFields.metadata }
    }

    // Find the specific token being spent
    const { outputs } = await this.wallet.listOutputs({
      basket: `${P_BASKET_PREFIX} ${parsedFields.assetId}`,
      include: 'locking scripts'
    })
    console.log('outputs', outputs)

    // const targetToken = outputs.find(output =>
    //   output.lockingScript && output.outpoint === parsedFields.assetId
    // )
    const targetToken = outputs[0]

    if (!targetToken || !targetToken.lockingScript) {
      throw new Error(`BTMS token not found: ${parsedFields.assetId}`)
    }

    // Validate token has sufficient balance
    const decoded = PushDrop.decode(LockingScript.fromHex(targetToken.lockingScript))
    const tokenAmount = Number(Utils.toUTF8(decoded.fields[1]))
    const requestedAmount = Number(parsedFields.amount)

    if (tokenAmount < requestedAmount) {
      throw new Error(`Insufficient token balance. Available: ${tokenAmount}, Requested: ${requestedAmount}`)
    }

    const tokenName = metadata.name || parsedFields.assetId

    // Ensure authorization exists before allowing signature
    await this.ensureBTMSAuthorization(
      parsedFields.assetId,
      parsedFields.amount,
      tokenName,
      originator
    )
  }

  /**
   * Ensures authorization exists for spending BTMS tokens.
   * Checks for existing on-chain permission first, only prompts user if not found.
   * 
   * @param assetId The BTMS asset ID (outpoint format: txid.vout)
   * @param requestedAmount Amount of tokens requested to spend (as string)
   * @param tokenName Human-readable token name for display
   * @param originator The app requesting permission
   */
  private async ensureBTMSAuthorization(
    assetId: string,
    requestedAmount: string,
    tokenName: string,
    originator: string
  ): Promise<void> {
    const permissionBasket = 'admin btms spending permission'

    // Check for existing on-chain permission
    try {
      const { outputs: permissions } = await this.wallet.listOutputs({
        basket: permissionBasket,
        tags: [`btms_assetId_${assetId}`, `btms_originator_${originator}`],
        include: 'locking scripts',
        limit: 100
      })

      // Check if any existing permission is valid
      for (const output of permissions) {
        if (!output.lockingScript) continue

        try {
          const decoded = PushDrop.decode(LockingScript.fromHex(output.lockingScript))
          const [scheme, permAssetId, permAmountStr, permOriginator] = decoded.fields.map(f => Utils.toUTF8(f))
          const permAmount = Number(permAmountStr)

          // Check if this permission is valid for the current request
          if (
            scheme === 'btms' &&
            permAssetId === assetId &&
            permOriginator === originator &&
            permAmount >= Number(requestedAmount)
          ) {
            return // Valid permission found, no prompt needed
          }
        } catch {
          // Skip invalid permission tokens
          continue
        }
      }
    } catch {
      // If permission check fails, continue to prompt user
      // This ensures the user can still grant permission even if the check errors
    }

    // No valid permission found - prompt user for authorization
    const message = `Spend ${requestedAmount} ${tokenName} token(s)\n\nAsset ID: ${assetId}\nApp: ${originator}`
    const approved = await this.promptUserForTokenUsage(originator, message)

    if (!approved) {
      throw new Error('User denied permission to spend BTMS token')
    }

    // Create on-chain permission token for future use
    await this.createPermissionOnChain(assetId, requestedAmount, originator)
  }

  /**
   * Creates an on-chain permission token in the admin basket.
   * This token authorizes future spends without requiring additional user prompts.
   * 
   * The permission token contains: [schemeID, assetId, amount, originator]
   * 
   * @param assetId The BTMS asset ID being authorized
   * @param amount The maximum amount authorized to spend
   * @param originator The app being granted permission
   */
  private async createPermissionOnChain(assetId: string, amount: string, originator: string): Promise<void> {
    const permissionBasket = 'admin btms spending permission'

    const lockingScript = await new PushDrop(this.wallet, this.adminOriginator).lock(
      [
        Utils.toArray('btms', 'utf8'),
        Utils.toArray(assetId, 'utf8'),
        Utils.toArray(amount, 'utf8'),
        Utils.toArray(originator, 'utf8')
      ],
      [2, 'admin btms spending permission'],
      '1',
      'self',
      true,
      true
    )

    await this.wallet.createAction(
      {
        description: `Grant BTMS spending authorization for ${assetId}`,
        outputs: [
          {
            lockingScript: lockingScript.toHex(),
            satoshis: 1,
            outputDescription: `BTMS spending authorization`,
            basket: permissionBasket,
            tags: [`btms_assetId_${assetId}`, `btms_originator_${originator}`]
          }
        ],
        options: {
          acceptDelayedBroadcast: false
        }
      },
      this.adminOriginator
    )
  }
}
