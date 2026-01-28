/**
 * @bsv/btms-core - Basic Token Management System
 * 
 * A modular library for managing UTXO-based tokens on the BSV blockchain.
 * 
 * This library provides:
 * - Token issuance with customizable metadata
 * - Token transfers between users
 * - Token receiving and acceptance
 * - Balance and asset queries
 * 
 * The implementation aligns exactly with the BTMSTopicManager protocol,
 * using a 3-field PushDrop schema:
 * - Field 0: assetId (or "ISSUE" for new tokens)
 * - Field 1: amount (positive integer as string)
 * - Field 2: metadata (optional JSON)
 * 
 * @example
 * ```typescript
 * import { BTMS } from '@bsv/btms-core'
 * 
 * // Create a BTMS instance
 * const btms = new BTMS({ networkPreset: 'mainnet' })
 * 
 * // Issue new tokens
 * const result = await btms.issue(1000, { name: 'MyToken' })
 * console.log('Asset ID:', result.assetId)
 * 
 * // Send tokens
 * await btms.send(result.assetId, recipientPubKey, 100)
 * 
 * // Check balance
 * const balance = await btms.getBalance(result.assetId)
 * ```
 * 
 * @packageDocumentation
 */

// Main class
export { BTMS } from './BTMS.js'

// Token encoding/decoding
export { BTMSToken } from './BTMSToken.js'

// Types
export type {
  // Protocol types
  BTMSTokenFields,
  DecodedBTMSToken,
  InvalidBTMSToken,
  BTMSTokenDecodeResult,

  // Asset types
  BTMSAsset,
  BTMSAssetMetadata,

  // Token output types
  BTMSTokenOutput,
  TokenForRecipient,
  IncomingPayment,

  // Operation result types
  IssueResult,
  SendResult,
  AcceptResult,

  // Configuration types
  BTMSConfig,
  ResolvedBTMSConfig,

  // Messaging types
  CommsLayer,

  // Marketplace types (future)
  MarketplaceListing,
  MarketplaceOffer,

  // Ownership proof types
  TokenKeyLinkage,
  ProvenToken,
  OwnershipProof,
  ProveOwnershipResult,
  VerifyOwnershipResult
} from './types.js'

// Constants
export {
  BTMS_TOPIC,
  BTMS_LOOKUP_SERVICE,
  BTMS_PROTOCOL_ID,
  BTMS_KEY_ID,
  BTMS_LABEL,
  BTMS_BASKET_PREFIX,
  DEFAULT_TOKEN_SATOSHIS,
  ISSUE_MARKER,
  MIN_TOKEN_AMOUNT,
  MAX_TOKEN_AMOUNT,
  MAX_METADATA_LENGTH,
  getAssetBasket
} from './constants.js'
