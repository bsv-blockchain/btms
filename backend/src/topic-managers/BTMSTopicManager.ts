import { AdmittanceInstructions, TopicManager } from '@bsv/overlay'
import { Beef, LockingScript, PushDrop, Transaction, Utils } from '@bsv/sdk'
import docs from '../docs/BTMSTopicManagerDocs.js'

/**
 * Implements a topic manager for BTMS token management
 * @public
 */
export default class BTMSTopicManager implements TopicManager {
  /**
   * Returns the outputs from the transaction that are admissible.
   * @param beef - The transaction data in BEEF format
   * @param previousCoins - The previous coins to consider (indices into the BEEF's input transactions)
   * @returns A promise that resolves with the admittance instructions
   */
  async identifyAdmissibleOutputs(beef: number[], previousCoins: number[]): Promise<AdmittanceInstructions> {
    const outputsToAdmit: number[] = []
    const coinsToRetain: number[] = []
    const coinsRemoved: number[] = []

    try {
      const parsedTransaction = Transaction.fromBEEF(beef)
      const beefObj = Beef.fromBinary(beef)

      // Validate params
      if (!Array.isArray(parsedTransaction.outputs)) {
        throw new Error('Missing parameter: outputs')
      }

      // Build previous UTXOs from BEEF data for coins we're spending
      interface PreviousUTXO {
        txid: string
        outputIndex: number
        lockingScript: LockingScript
        coinIndex: number
      }
      const previousUTXOs: PreviousUTXO[] = []

      // Parse BEEF to get source transactions for previous coins
      for (const coinIndex of previousCoins) {
        const input = parsedTransaction.inputs[coinIndex]
        if (!input) continue

        // Get source transaction from input (primary path)
        let sourceTx = input.sourceTransaction
        const sourceTxid = sourceTx?.id('hex') ?? input.sourceTXID

        // Fallback: look up source transaction in the BEEF by txid
        if (!sourceTx && sourceTxid) {
          sourceTx = beefObj.findTxid(sourceTxid)?.tx
        }

        if (!sourceTx || !sourceTxid) continue

        const sourceOutputIndex = input.sourceOutputIndex
        const sourceOutput = sourceTx.outputs[sourceOutputIndex]

        if (sourceOutput?.lockingScript) {
          previousUTXOs.push({
            txid: sourceTxid,
            outputIndex: sourceOutputIndex,
            lockingScript: sourceOutput.lockingScript,
            coinIndex
          })
        }
      }

      // First, we build an object with the assets we are allowed to spend.
      // For each asset, we track the amount we are allowed to spend.
      // It is valid to spend any asset issuance output, with the full amount of the issuance.
      // It is also valid to spend any output with an asset ID, and we add those together across all the previous UTXOs to get the total amount for that asset.
      const maxNumberOfEachAsset: Record<string, { amount: number, metadata: string | undefined }> = {}

      for (const p of previousUTXOs) {
        try {
          const decoded = PushDrop.decode(p.lockingScript)
          const field0 = Utils.toUTF8(decoded.fields[0])
          let assetId: string
          if (field0 === 'ISSUE') {
            assetId = `${p.txid}.${p.outputIndex}`
          } else {
            assetId = field0
          }

          const amount = Number(Utils.toUTF8(decoded.fields[1]))
          const metadata = decoded.fields.length === 4 ? Utils.toUTF8(decoded.fields[2]) : undefined

          // Track the amounts for previous UTXOs
          if (!maxNumberOfEachAsset[assetId]) {
            maxNumberOfEachAsset[assetId] = {
              amount,
              metadata
            }
          } else {
            maxNumberOfEachAsset[assetId].amount += amount
          }
        } catch (e) {
          console.log(`[BTMSTopicManager] Failed to decode previous UTXO ${p.txid}.${p.outputIndex}:`, e)
          continue
        }
      }

      // For each output, it is valid as long as either:
      // 1. It is an issuance of a new asset, or
      // 2. The total for that asset does not exceed what's allowed
      // We need an object to track totals for each asset
      const assetTotals: Record<string, number> = {}

      for (const [i, output] of parsedTransaction.outputs.entries()) {
        try {
          const decoded = PushDrop.decode(output.lockingScript)
          const assetId = Utils.toUTF8(decoded.fields[0])

          // Issuance outputs are always valid
          if (assetId === 'ISSUE') {
            outputsToAdmit.push(i)
            continue
          }

          // Initialize the asset at 0 if necessary
          if (!assetTotals[assetId]) {
            assetTotals[assetId] = 0
          }

          // Add the amount for this asset
          const amount = Number(Utils.toUTF8(decoded.fields[1]))
          assetTotals[assetId] += amount

          // Validate the amount and metadata
          const metadata = decoded.fields.length === 4 ? Utils.toUTF8(decoded.fields[2]) : undefined
          if (!maxNumberOfEachAsset[assetId]) {
            continue
          }
          if (assetTotals[assetId] > maxNumberOfEachAsset[assetId].amount) {
            continue
          }
          if (maxNumberOfEachAsset[assetId].metadata !== metadata) {
            continue
          }
          outputsToAdmit.push(i)
        } catch (e) {
          continue
        }
      }

      // Determine which previous coins to retain
      for (const p of previousUTXOs) {
        try {
          const decodedPrevious = PushDrop.decode(p.lockingScript)
          const field0 = Utils.toUTF8(decodedPrevious.fields[0])
          let assetId: string
          if (field0 === 'ISSUE') {
            assetId = `${p.txid}.${p.outputIndex}`
          } else {
            assetId = field0
          }

          // Assets included in the inputs but not the admitted outputs are not retained, otherwise they are.
          const assetInOutputs = parsedTransaction.outputs.some((x, i) => {
            if (!outputsToAdmit.includes(i)) {
              return false
            }
            try {
              const decodedCurrent = PushDrop.decode(x.lockingScript)
              return Utils.toUTF8(decodedCurrent.fields[0]) === assetId
            } catch {
              return false
            }
          })

          if (assetInOutputs) {
            coinsToRetain.push(p.coinIndex)
          }
        } catch {
          continue
        }
      }
      coinsRemoved.push(...previousCoins.filter((coinIndex) => !coinsToRetain.includes(coinIndex)))

      return {
        outputsToAdmit,
        coinsToRetain,
        coinsRemoved
      }
    } catch (error) {
      return {
        outputsToAdmit: [],
        coinsToRetain: [],
        coinsRemoved: []
      }
    }
  }

  /**
   * Returns the documentation for the tokenization protocol
   */
  async getDocumentation(): Promise<string> {
    return docs
  }

  /**
   * Get metadata about the topic manager
   * @returns A promise that resolves to an object containing metadata
   */
  async getMetaData(): Promise<{
    name: string
    shortDescription: string
    iconURL?: string
    version?: string
    informationURL?: string
  }> {
    return {
      name: 'BTMS Topic Manager',
      shortDescription: 'Basic Token Management System for UTXO-based tokens'
    }
  }
}
