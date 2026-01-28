/**
 * Utility functions for BTMS
 */

/**
 * Extract keyID from customInstructions stored with a UTXO.
 * 
 * @param customInstructions - The customInstructions JSON string
 * @param txid - Transaction ID (for error messages)
 * @param outputIndex - Output index (for error messages)
 * @returns The keyID string (derivationPrefix + ' ' + derivationSuffix)
 * @throws Error if customInstructions are missing or invalid
 */
export function extractKeyIDFromCustomInstructions(
  customInstructions: string | undefined,
  txid: string,
  outputIndex: number
): string {
  if (!customInstructions) {
    throw new Error(`Missing customInstructions for UTXO ${txid}.${outputIndex}`)
  }
  try {
    const instructions = JSON.parse(customInstructions)
    if (instructions.derivationPrefix && instructions.derivationSuffix) {
      return `${instructions.derivationPrefix} ${instructions.derivationSuffix}`
    } else {
      throw new Error('Missing derivation info in customInstructions')
    }
  } catch (error) {
    throw new Error(`Invalid customInstructions for UTXO ${txid}.${outputIndex}: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
