/**
 * Utility functions for BTMS
 */

/**
 * Parsed custom instructions containing key derivation info
 */
export interface ParsedCustomInstructions {
  /** The keyID string (derivationPrefix + ' ' + derivationSuffix) */
  keyID: string
  /** The sender's identity key (counterparty for unlocking) */
  senderIdentityKey?: string
}

/**
 * Extract keyID and senderIdentityKey from customInstructions stored with a UTXO.
 * 
 * @param customInstructions - The customInstructions JSON string
 * @param txid - Transaction ID (for error messages)
 * @param outputIndex - Output index (for error messages)
 * @returns Parsed instructions containing keyID and optional senderIdentityKey
 * @throws Error if customInstructions are missing or invalid
 */
export function parseCustomInstructions(
  customInstructions: string | undefined,
  txid: string,
  outputIndex: number
): ParsedCustomInstructions {
  if (!customInstructions) {
    throw new Error(`Missing customInstructions for UTXO ${txid}.${outputIndex}`)
  }
  try {
    const instructions = JSON.parse(customInstructions)
    if (instructions.derivationPrefix && instructions.derivationSuffix) {
      return {
        keyID: `${instructions.derivationPrefix} ${instructions.derivationSuffix}`,
        senderIdentityKey: instructions.senderIdentityKey
      }
    } else {
      throw new Error('Missing derivation info in customInstructions')
    }
  } catch (error) {
    throw new Error(`Invalid customInstructions for UTXO ${txid}.${outputIndex}: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

