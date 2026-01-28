/**
 * BTMS Core Type Definitions
 * 
 * Type definitions for the Basic Token Management System.
 * These types align with the BTMSTopicManager protocol.
 */

import type {
  WalletInterface,
  AtomicBEEF,
  SatoshiValue,
  PubKeyHex,
  TXIDHexString,
  HexString,
  BasketStringUnder300Bytes,
  WalletProtocol,
  KeyIDStringUnder800Bytes
} from '@bsv/sdk'

// ---------------------------------------------------------------------------
// Protocol Types (aligned with BTMSTopicManager)
// ---------------------------------------------------------------------------

/**
 * BTMS Token Protocol Field Schema
 * 
 * The BTMSTopicManager expects exactly 3 fields in PushDrop tokens:
 * - Field 0: assetId (or "ISSUE" for new token issuance)
 * - Field 1: amount (as UTF-8 string of a positive integer)
 * - Field 2: metadata (optional JSON string)
 * 
 * For ISSUE tokens, the canonical assetId becomes `{txid}.{outputIndex}`
 * after the transaction is mined.
 */
export interface BTMSTokenFields {
  /** 
   * For issuance: "ISSUE" literal
   * For transfers: the canonical assetId (e.g., "abc123.0")
   */
  assetId: string
  /** Token amount (positive integer) */
  amount: number
  /** Optional JSON metadata string */
  metadata?: string
}

/**
 * Decoded BTMS token from a locking script
 */
export interface DecodedBTMSToken {
  /** Whether the token is valid according to BTMS protocol */
  valid: true
  /** The asset identifier (or "ISSUE" for issuance outputs) */
  assetId: string
  /** Token amount */
  amount: number
  /** Optional metadata JSON string */
  metadata?: string
  /** The locking public key from PushDrop */
  lockingPublicKey: string
}

/**
 * Invalid token decode result
 */
export interface InvalidBTMSToken {
  valid: false
  error?: string
}

/**
 * Result of decoding a BTMS token
 */
export type BTMSTokenDecodeResult = DecodedBTMSToken | InvalidBTMSToken

// ---------------------------------------------------------------------------
// Asset Types
// ---------------------------------------------------------------------------

/**
 * Represents a BTMS token asset
 */
export interface BTMSAsset {
  /** Canonical asset ID (txid.outputIndex format) */
  assetId: string
  /** Human-readable name from metadata */
  name?: string
  /** Current balance owned by this wallet */
  balance: number
  /** Asset metadata */
  metadata?: BTMSAssetMetadata
  /** Whether there are pending incoming tokens */
  hasPendingIncoming?: boolean
}

/**
 * Asset metadata structure
 */
export interface BTMSAssetMetadata {
  /** Asset name */
  name?: string
  /** Asset description */
  description?: string
  /** Asset icon URL */
  iconURL?: string
  /** Additional custom fields */
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// UTXO Selection Types
// ---------------------------------------------------------------------------

/**
 * UTXO selection strategy for spending tokens.
 * Different strategies optimize for different goals.
 */
export type SelectionStrategy =
  | 'largest-first'   // Greedy: use largest UTXOs first (minimizes UTXO count)
  | 'smallest-first'  // Use smallest UTXOs first (preserves large UTXOs for big payments)
  | 'exact-match'     // Try to find exact match first, then fall back to largest-first
  | 'random'          // Random selection (privacy-preserving)

/**
 * Options for UTXO selection
 */
export interface SelectionOptions {
  /** Selection strategy to use (default: 'largest-first') */
  strategy?: SelectionStrategy
  /** Fallback strategy when exact-match fails (default: 'largest-first') */
  fallbackStrategy?: Exclude<SelectionStrategy, 'exact-match'>
  /** Maximum number of UTXOs to select (default: unlimited) */
  maxInputs?: number
  /** Minimum UTXO amount to consider (default: 0) */
  minUtxoAmount?: number
}

/**
 * Result of UTXO selection
 */
export interface SelectionResult<T> {
  /** Selected UTXOs */
  selected: T[]
  /** Total input amount from selected UTXOs */
  totalInput: number
  /** UTXOs that were excluded (not found on overlay, etc.) */
  excluded: T[]
}

// ---------------------------------------------------------------------------
// Token Output Types
// ---------------------------------------------------------------------------

/**
 * A BTMS token UTXO from the wallet
 */
export interface BTMSTokenOutput {
  /** Outpoint in "txid.outputIndex" format */
  outpoint: string
  /** Transaction ID */
  txid: TXIDHexString
  /** Output index */
  outputIndex: number
  /** Satoshi value (typically 1 for BTMS tokens) */
  satoshis: SatoshiValue
  /** Locking script hex */
  lockingScript: HexString
  /** Custom instructions containing derivation keys */
  customInstructions?: string
  /** Decoded token data */
  token: DecodedBTMSToken
  /** Whether this output is spendable */
  spendable: boolean
  /** Full transaction BEEF (when available) */
  beef?: AtomicBEEF
}

/**
 * Token data sent to a recipient
 */
export interface TokenForRecipient {
  /** Transaction ID containing the token */
  txid: TXIDHexString
  /** Output index of the token */
  outputIndex: number
  /** Locking script hex */
  lockingScript: HexString
  /** Token amount */
  amount: number
  /** Satoshi value */
  satoshis: SatoshiValue
  /** Full BEEF for SPV verification */
  beef: AtomicBEEF
  /** Custom instructions containing derivation keys */
  customInstructions: string
  /** Asset ID */
  assetId: string
  /** Metadata JSON */
  metadata?: string
}

/**
 * Incoming token from another user.
 * Extends TokenForRecipient with messaging metadata.
 */
export interface IncomingToken extends TokenForRecipient {
  /** Sender's identity key (added by messaging layer) */
  sender: PubKeyHex
  /** Message ID for acknowledgment (added by messaging layer) */
  messageId: string
}

// ---------------------------------------------------------------------------
// Operation Result Types
// ---------------------------------------------------------------------------

/**
 * Result of a token issuance operation
 */
export interface IssueResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Transaction ID of the issuance */
  txid: TXIDHexString
  /** Canonical asset ID (txid.0 for single output) */
  assetId: string
  /** Output index of the token */
  outputIndex: number
  /** Amount issued */
  amount: number
  /** Error message if failed */
  error?: string
}

/**
 * Result of a token send operation
 */
export interface SendResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Transaction ID */
  txid: TXIDHexString
  /** Token data for recipient */
  tokenForRecipient: TokenForRecipient
  /** Change amount returned to sender (if any) */
  changeAmount?: number
  /** Error message if failed */
  error?: string
}

/**
 * Result of accepting an incoming payment
 */
export interface AcceptResult {
  /** Whether the operation succeeded */
  success: boolean
  /** The accepted asset ID */
  assetId: string
  /** Amount accepted */
  amount: number
  /** Error message if failed */
  error?: string
}

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

/**
 * BTMS configuration options
 */
export interface BTMSConfig {
  /** Wallet interface for signing transactions */
  wallet?: WalletInterface
  /** Network preset for overlay services */
  networkPreset?: 'local' | 'mainnet' | 'testnet'
  /** Custom overlay host URLs */
  overlayHosts?: string[]
  /** Satoshi value for token outputs (default: 1) */
  tokenSatoshis?: SatoshiValue
  /** Protocol ID for wallet operations */
  protocolID?: WalletProtocol
  /** Key ID for protocol operations */
  keyID?: KeyIDStringUnder800Bytes
  /** Optional communications layer for token messaging (e.g., MessageBoxClient) */
  comms?: CommsLayer
  /** Message box name for token delivery (default: 'btms_tokens') */
  messageBox?: string
}

/**
 * Resolved BTMS configuration with defaults applied
 */
export interface ResolvedBTMSConfig {
  wallet: WalletInterface
  networkPreset: 'local' | 'mainnet' | 'testnet'
  overlayHosts: string[]
  tokenSatoshis: SatoshiValue
  protocolID: WalletProtocol
  keyID: KeyIDStringUnder800Bytes
  comms?: CommsLayer
  messageBox: string
}

// ---------------------------------------------------------------------------
// Messaging Types (for extensibility)
// ---------------------------------------------------------------------------

/**
 * Generic communications layer interface.
 * 
 * This mirrors the CommsLayer interface from @bsv/sdk for messaging primitives.
 * BTMS uses this for token delivery via message-box or other transports.
 */
export interface CommsLayer {
  /**
   * Sends a message over the store-and-forward channel.
   */
  sendMessage(args: { recipient: PubKeyHex, messageBox: string, body: string }, hostOverride?: string): Promise<string>

  /**
   * Lists pending messages for a message box.
   */
  listMessages(args: { messageBox: string, host?: string }): Promise<Array<{
    messageId: string
    sender: PubKeyHex
    body: string
  }>>

  /**
   * Acknowledges messages (deletes them from the server).
   */
  acknowledgeMessage(args: { messageIds: string[] }): Promise<void>
}


// ---------------------------------------------------------------------------
// Ownership Proof Types
// ---------------------------------------------------------------------------

/**
 * Key linkage revelation for a specific token
 */
export interface TokenKeyLinkage {
  /** The prover's identity public key */
  prover: PubKeyHex
  /** The verifier's identity public key */
  verifier: PubKeyHex
  /** The counterparty (for BTMS, typically 'self' resolved to prover's key) */
  counterparty: PubKeyHex
  /** Encrypted linkage data */
  encryptedLinkage: number[]
  /** Encrypted linkage proof */
  encryptedLinkageProof: number[]
  /** Proof type byte */
  proofType: number
}

/**
 * A proven token with its output data and key linkage
 */
export interface ProvenToken {
  /** The token output being proven */
  output: {
    txid: TXIDHexString
    outputIndex: number
    lockingScript: HexString
    satoshis: SatoshiValue
  }
  /** Key linkage revelation for this token */
  linkage: TokenKeyLinkage
}

/**
 * Ownership proof for a set of tokens
 */
export interface OwnershipProof {
  /** The prover's identity public key */
  prover: PubKeyHex
  /** The verifier's identity public key */
  verifier: PubKeyHex
  /** The proven tokens with their linkages */
  tokens: ProvenToken[]
  /** Total amount being proven */
  amount: number
  /** Asset ID being proven */
  assetId: string
}

/**
 * Result of proving ownership
 */
export interface ProveOwnershipResult {
  /** Whether the operation succeeded */
  success: boolean
  /** The ownership proof (if successful) */
  proof?: OwnershipProof
  /** Error message if failed */
  error?: string
}

/**
 * Result of verifying ownership
 */
export interface VerifyOwnershipResult {
  /** Whether the proof is valid */
  valid: boolean
  /** The verified amount */
  amount?: number
  /** The verified asset ID */
  assetId?: string
  /** The prover's identity key */
  prover?: PubKeyHex
  /** Error message if verification failed */
  error?: string
}

// ---------------------------------------------------------------------------
// Marketplace Types (for future extensibility)
// ---------------------------------------------------------------------------

/**
 * Marketplace listing for atomic swaps (future use)
 */
export interface MarketplaceListing {
  /** Listing ID */
  listingId: string
  /** Asset being sold */
  assetId: string
  /** Amount for sale */
  amount: number
  /** Price in satoshis */
  priceSatoshis: number
  /** Seller's identity key */
  seller: PubKeyHex
  /** Listing expiry timestamp */
  expiresAt?: number
}

/**
 * Marketplace offer for atomic swaps (future use)
 */
export interface MarketplaceOffer {
  /** Offer ID */
  offerId: string
  /** Listing being offered on */
  listingId: string
  /** Offered price in satoshis */
  offerSatoshis: number
  /** Buyer's identity key */
  buyer: PubKeyHex
  /** Offer expiry timestamp */
  expiresAt?: number
}
