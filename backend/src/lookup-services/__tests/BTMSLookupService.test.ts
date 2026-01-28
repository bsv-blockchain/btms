import { BTMSLookupService } from '../BTMSLookupServiceFactory'
import { BTMSStorageManager } from '../BTMSStorageManager'
import { LockingScript, PrivateKey, PublicKey, Utils } from '@bsv/sdk'
import { OutputAdmittedByTopic, LookupQuestion } from '@bsv/overlay'

/**
 * Helper to create a simple PushDrop-style locking script for testing.
 */
function createPushDropScript(pubKey: PublicKey, fields: string[]): LockingScript {
  const chunks: Array<{ op: number; data?: number[] }> = []

  // P2PK lock
  const pubKeyHex = pubKey.toString()
  chunks.push({ op: pubKeyHex.length / 2, data: Utils.toArray(pubKeyHex, 'hex') })
  chunks.push({ op: 0xac }) // OP_CHECKSIG

  // Push fields
  for (const field of fields) {
    const data = Utils.toArray(field, 'utf8')
    if (data.length <= 75) {
      chunks.push({ op: data.length, data })
    } else if (data.length <= 255) {
      chunks.push({ op: 0x4c, data }) // OP_PUSHDATA1
    } else {
      chunks.push({ op: 0x4d, data }) // OP_PUSHDATA2
    }
  }

  // Drop fields
  let remaining = fields.length
  while (remaining > 1) {
    chunks.push({ op: 0x6d }) // OP_2DROP
    remaining -= 2
  }
  if (remaining === 1) {
    chunks.push({ op: 0x75 }) // OP_DROP
  }

  return new LockingScript(chunks)
}

/**
 * Mock storage manager for testing
 */
class MockBTMSStorageManager {
  private records: Map<string, any> = new Map()

  async storeRecord(
    txid: string,
    outputIndex: number,
    assetId: string,
    amount: number,
    ownerKey: string,
    metadata?: string
  ): Promise<void> {
    const key = `${txid}.${outputIndex}`
    this.records.set(key, {
      txid,
      outputIndex,
      assetId,
      amount,
      ownerKey,
      metadata,
      createdAt: new Date()
    })
  }

  async deleteRecord(txid: string, outputIndex: number): Promise<void> {
    const key = `${txid}.${outputIndex}`
    this.records.delete(key)
  }

  async findWithFilters(
    filters: { assetId?: string; ownerKey?: string },
    limit: number = 50,
    skip: number = 0,
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<any[]> {
    let results = Array.from(this.records.values())

    if (filters.assetId) {
      results = results.filter(r => r.assetId === filters.assetId)
    }
    if (filters.ownerKey) {
      results = results.filter(r => r.ownerKey === filters.ownerKey)
    }

    // Sort
    results.sort((a, b) => {
      const diff = a.createdAt.getTime() - b.createdAt.getTime()
      return sortOrder === 'desc' ? -diff : diff
    })

    return results.slice(skip, skip + limit)
  }

  async findAllRecords(
    limit: number = 50,
    skip: number = 0,
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<any[]> {
    return this.findWithFilters({}, limit, skip, sortOrder)
  }

  getRecordCount(): number {
    return this.records.size
  }

  getRecord(txid: string, outputIndex: number): any {
    return this.records.get(`${txid}.${outputIndex}`)
  }
}

describe('BTMS Lookup Service', () => {
  let service: BTMSLookupService
  let mockStorage: MockBTMSStorageManager
  let testPrivKey: PrivateKey
  let testPubKey: PublicKey

  beforeEach(() => {
    mockStorage = new MockBTMSStorageManager()
    service = new BTMSLookupService(mockStorage as unknown as BTMSStorageManager)
    testPrivKey = PrivateKey.fromRandom()
    testPubKey = testPrivKey.toPublicKey()
  })

  describe('outputAdmittedByTopic', () => {
    it('stores an issuance token correctly', async () => {
      const lockingScript = createPushDropScript(testPubKey, ['ISSUE', '100'])

      await service.outputAdmittedByTopic({
        mode: 'locking-script',
        txid: 'abc123',
        outputIndex: 0,
        topic: 'tm_btms',
        lockingScript
      } as OutputAdmittedByTopic)

      const record = mockStorage.getRecord('abc123', 0)
      expect(record).toBeDefined()
      expect(record.assetId).toBe('abc123.0')
      expect(record.amount).toBe(100)
      expect(record.ownerKey).toBe(testPubKey.toString())
    })

    it('stores a non-issuance token correctly', async () => {
      const lockingScript = createPushDropScript(testPubKey, ['existingAsset.5', '50'])

      await service.outputAdmittedByTopic({
        mode: 'locking-script',
        txid: 'def456',
        outputIndex: 1,
        topic: 'tm_btms',
        lockingScript
      } as OutputAdmittedByTopic)

      const record = mockStorage.getRecord('def456', 1)
      expect(record).toBeDefined()
      expect(record.assetId).toBe('existingAsset.5')
      expect(record.amount).toBe(50)
    })

    it('stores a token with metadata', async () => {
      const lockingScript = createPushDropScript(testPubKey, ['ISSUE', '200', 'My Token Metadata'])

      await service.outputAdmittedByTopic({
        mode: 'locking-script',
        txid: 'ghi789',
        outputIndex: 0,
        topic: 'tm_btms',
        lockingScript
      } as OutputAdmittedByTopic)

      const record = mockStorage.getRecord('ghi789', 0)
      expect(record).toBeDefined()
      expect(record.metadata).toBe('My Token Metadata')
    })

    it('ignores outputs from other topics', async () => {
      const lockingScript = createPushDropScript(testPubKey, ['ISSUE', '100'])

      await service.outputAdmittedByTopic({
        mode: 'locking-script',
        txid: 'xyz999',
        outputIndex: 0,
        topic: 'tm_other',
        lockingScript
      } as OutputAdmittedByTopic)

      expect(mockStorage.getRecordCount()).toBe(0)
    })

    it('throws on invalid payload mode', async () => {
      const lockingScript = createPushDropScript(testPubKey, ['ISSUE', '100'])

      await expect(service.outputAdmittedByTopic({
        mode: 'output-script' as any,
        txid: 'abc123',
        outputIndex: 0,
        topic: 'tm_btms',
        lockingScript
      } as OutputAdmittedByTopic)).rejects.toThrow('Invalid payload mode')
    })
  })

  describe('outputSpent', () => {
    it('deletes a record when output is spent', async () => {
      // First add a record
      const lockingScript = createPushDropScript(testPubKey, ['ISSUE', '100'])
      await service.outputAdmittedByTopic({
        mode: 'locking-script',
        txid: 'spend123',
        outputIndex: 0,
        topic: 'tm_btms',
        lockingScript
      } as OutputAdmittedByTopic)

      expect(mockStorage.getRecordCount()).toBe(1)

      // Now spend it
      await service.outputSpent({
        mode: 'none',
        txid: 'spend123',
        outputIndex: 0,
        topic: 'tm_btms'
      })

      expect(mockStorage.getRecordCount()).toBe(0)
    })

    it('ignores spends from other topics', async () => {
      const lockingScript = createPushDropScript(testPubKey, ['ISSUE', '100'])
      await service.outputAdmittedByTopic({
        mode: 'locking-script',
        txid: 'keep123',
        outputIndex: 0,
        topic: 'tm_btms',
        lockingScript
      } as OutputAdmittedByTopic)

      await service.outputSpent({
        mode: 'none',
        txid: 'keep123',
        outputIndex: 0,
        topic: 'tm_other'
      })

      expect(mockStorage.getRecordCount()).toBe(1)
    })
  })

  describe('lookup', () => {
    beforeEach(async () => {
      // Add some test records
      await mockStorage.storeRecord('tx1', 0, 'asset1.0', 100, testPubKey.toString())
      await mockStorage.storeRecord('tx2', 0, 'asset1.0', 50, testPubKey.toString())
      await mockStorage.storeRecord('tx3', 0, 'asset2.0', 200, 'otherKey')
    })

    it('looks up all records when no filters', async () => {
      const result = await service.lookup({
        service: 'ls_btms',
        query: {}
      } as LookupQuestion)

      expect(result).toHaveLength(3)
    })

    it('filters by assetId', async () => {
      const result = await service.lookup({
        service: 'ls_btms',
        query: { assetId: 'asset1.0' }
      } as LookupQuestion)

      expect(result).toHaveLength(2)
    })

    it('filters by ownerKey', async () => {
      const result = await service.lookup({
        service: 'ls_btms',
        query: { ownerKey: testPubKey.toString() }
      } as LookupQuestion)

      expect(result).toHaveLength(2)
    })

    it('applies pagination', async () => {
      const result = await service.lookup({
        service: 'ls_btms',
        query: { limit: 2, skip: 1 }
      } as LookupQuestion)

      expect(result).toHaveLength(2)
    })

    it('throws on invalid service', async () => {
      await expect(service.lookup({
        service: 'ls_other',
        query: {}
      } as LookupQuestion)).rejects.toThrow('Lookup service not supported')
    })

    it('throws on missing query', async () => {
      await expect(service.lookup({
        service: 'ls_btms',
        query: null
      } as unknown as LookupQuestion)).rejects.toThrow('A valid query must be provided')
    })
  })

  describe('getDocumentation', () => {
    it('returns documentation string', async () => {
      const docsResult = await service.getDocumentation()
      expect(typeof docsResult).toBe('string')
      expect(docsResult.length).toBeGreaterThan(0)
    })
  })

  describe('getMetaData', () => {
    it('returns metadata object', async () => {
      const meta = await service.getMetaData()
      expect(meta.name).toBe('BTMS Lookup Service')
      expect(meta.shortDescription).toBeDefined()
    })
  })
})
