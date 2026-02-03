import { BTMSStorageManager } from './BTMSStorageManager.js'
import { AdmissionMode, LookupFormula, LookupQuestion, LookupService, OutputAdmittedByTopic, OutputSpent, SpendNotificationMode } from '@bsv/overlay'
import { PushDrop, Transaction, Utils } from '@bsv/sdk'
import { Db } from 'mongodb'
import { btmsProtocol, BTMSLookupResult, BTMSQuery, BTMSRecord } from './types.js'
import docs from '../docs/BTMSLookupDocs.md.js'

/**
 * Implements a lookup service for BTMS tokens
 * @public
 */
class BTMSLookupService implements LookupService {
  readonly admissionMode: AdmissionMode = 'locking-script'
  readonly spendNotificationMode: SpendNotificationMode = 'none'

  private static readonly TOPIC = 'tm_btms'
  private static readonly SERVICE_ID = 'ls_btms'

  constructor(public storageManager: BTMSStorageManager) { }

  async outputAdmittedByTopic(payload: OutputAdmittedByTopic): Promise<void> {
    if (payload.mode !== 'locking-script') {
      throw new Error('Invalid payload mode')
    }

    const { txid, outputIndex, topic, lockingScript } = payload
    if (topic !== BTMSLookupService.TOPIC) {
      return
    }

    try {
      const decoded = PushDrop.decode(lockingScript)

      // BTMS tokens have 2-3 fields: [assetId, amount, metadata?]
      if (decoded.fields.length < 3 || decoded.fields.length > 4) {
        throw new Error(`BTMS token must have 2-3 fields + signature, got ${decoded.fields.length}`)
      }

      const assetIdField = Utils.toUTF8(decoded.fields[btmsProtocol.assetId])
      const amount = Number(Utils.toUTF8(decoded.fields[btmsProtocol.amount]))

      // Determine the actual assetId
      let assetId: string
      if (assetIdField === 'ISSUE') {
        assetId = `${txid}.${outputIndex}`
      } else {
        assetId = assetIdField
      }

      // Extract metadata if present
      const metadata = decoded.fields[btmsProtocol.metadata]
        ? Utils.toUTF8(decoded.fields[btmsProtocol.metadata])
        : undefined

      // Get owner key from the PushDrop lock
      const ownerKey = decoded.lockingPublicKey.toString()

      await this.storageManager.storeRecord(
        txid,
        outputIndex,
        assetId,
        amount,
        ownerKey,
        metadata
      )
    } catch (error) {
      console.error('Error processing BTMS output:', error)
      throw error
    }
  }

  async outputSpent(payload: OutputSpent): Promise<void> {
    if (payload.mode !== 'none') throw new Error('Invalid payload mode')
    const { topic, txid, outputIndex } = payload
    if (topic !== BTMSLookupService.TOPIC) return

    await this.storageManager.deleteRecord(txid, outputIndex)
  }

  async outputEvicted(txid: string, outputIndex: number): Promise<void> {
    await this.storageManager.deleteRecord(txid, outputIndex)
  }

  async lookup(question: LookupQuestion): Promise<LookupFormula> {
    if (question.query === undefined || question.query === null) {
      throw new Error('A valid query must be provided')
    }
    if (question.service !== BTMSLookupService.SERVICE_ID) {
      throw new Error('Lookup service not supported')
    }

    const query = question.query as BTMSQuery

    // Check if we have any filters to apply
    const hasFilters = query.assetId || query.ownerKey

    let results: BTMSRecord[]

    if (hasFilters) {
      results = await this.storageManager.findWithFilters(
        {
          assetId: query.assetId,
          ownerKey: query.ownerKey
        },
        query.limit,
        query.skip,
        query.sortOrder
      )
    } else {
      results = await this.storageManager.findAllRecords(
        query.limit,
        query.skip,
        query.sortOrder
      )
    }

    const lookupResults: BTMSLookupResult[] = []

    for (const result of results) {
      lookupResults.push({
        txid: result.txid,
        outputIndex: result.outputIndex,
        history: query.history
          ? async (beef: number[], outputIndex: number, currentDepth: number) => {
            return await this.historySelector(beef, outputIndex, result.assetId)
          }
          : undefined
      })
    }

    return lookupResults
  }

  /**
   * History selector for determining which outputs to include in chain tracking
   */
  private async historySelector(beef: number[], outputIndex: number, assetId?: string): Promise<boolean> {
    try {
      const tx = Transaction.fromBEEF(beef)
      const decoded = PushDrop.decode(tx.outputs[outputIndex].lockingScript)

      // Validate BTMS structure (2-3 fields)
      if (decoded.fields.length < 2 || decoded.fields.length > 3) {
        return false
      }

      // Extract the output's assetId
      const outputAssetId = Utils.toUTF8(decoded.fields[btmsProtocol.assetId])

      // If we have context (assetId), only include outputs that match
      if (assetId !== undefined && outputAssetId !== assetId && outputAssetId !== 'ISSUE') {
        return false
      }

      return true
    } catch (error) {
      return false
    }
  }

  async getDocumentation(): Promise<string> {
    return docs
  }

  async getMetaData(): Promise<{
    name: string
    shortDescription: string
    iconURL?: string
    version?: string
    informationURL?: string
  }> {
    return {
      name: 'BTMS Lookup Service',
      shortDescription: 'Find BTMS tokens by asset ID or owner key.'
    }
  }
}

// Factory function
export default (db: Db): BTMSLookupService => {
  return new BTMSLookupService(new BTMSStorageManager(db))
}

export { BTMSLookupService }
