/**
 * BTMS Protocol Constants
 * 
 * Constants used throughout the BTMS core library.
 * These align with the BTMSTopicManager protocol.
 */

import type { WalletProtocol, SatoshiValue, BasketStringUnder300Bytes } from '@bsv/sdk'

// ---------------------------------------------------------------------------
// Protocol Constants
// ---------------------------------------------------------------------------

/** BTMS Topic Manager identifier */
export const BTMS_TOPIC = 'tm_btms'

/** BTMS Lookup Service identifier */
export const BTMS_LOOKUP_SERVICE = 'ls_btms'

/** Literal used in field[0] to indicate token issuance */
export const ISSUE_MARKER = 'ISSUE'

/** Default satoshi value for BTMS token outputs */
export const DEFAULT_TOKEN_SATOSHIS = 1 as SatoshiValue

// ---------------------------------------------------------------------------
// Wallet Protocol Constants
// ---------------------------------------------------------------------------

/**
 * BTMS Protocol ID for wallet operations
 * 
 * Format: [securityLevel, protocolName]
 * - Security level 0: No special security requirements
 * - Protocol name "btms tokens": Basic Token Management System
 */
export const BTMS_PROTOCOL_ID: WalletProtocol = [0, 'btms tokens']

/** Default key ID for BTMS operations */
export const BTMS_KEY_ID = '1'

// ---------------------------------------------------------------------------
// Basket Constants
// ---------------------------------------------------------------------------

/**
 * Basket prefix for BTMS tokens
 * 
 * Token baskets follow the pattern: "p btms {assetId}"
 * The "p" prefix indicates permission-based basket access for the BTMS permission module.
 * 
 * Example: "p btms abc123def456789...0"
 */
export const BTMS_BASKET_PREFIX = 'p btms'

/**
 * Generate a basket name for a specific asset.
 * 
 * Uses the "p btms <assetId>" format for permission-based basket access.
 * This allows the BTMS permission module to control access to these tokens.
 * 
 * @param assetId - The canonical asset ID (txid.outputIndex format)
 * @returns Basket name in "p btms <assetId>" format
 */
export function getAssetBasket(assetId: string): BasketStringUnder300Bytes {
  return `${BTMS_BASKET_PREFIX} ${assetId}` as BasketStringUnder300Bytes
}

// ---------------------------------------------------------------------------
// Label Constants
// ---------------------------------------------------------------------------

/** Label for BTMS transactions (for discovery via listActions) */
export const BTMS_LABEL = 'btms'

// ---------------------------------------------------------------------------
// Validation Constants
// ---------------------------------------------------------------------------

/** Maximum allowed token amount */
export const MAX_TOKEN_AMOUNT = Number.MAX_SAFE_INTEGER

/** Minimum allowed token amount */
export const MIN_TOKEN_AMOUNT = 1

/** Maximum metadata JSON length (in bytes) */
export const MAX_METADATA_LENGTH = 65536
