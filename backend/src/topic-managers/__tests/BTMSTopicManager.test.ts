import BTMSTopicManager from '../BTMSTopicManager'
import { LockingScript, PrivateKey, PublicKey, Script, Transaction, Utils } from '@bsv/sdk'

/**
 * Helper to create a simple PushDrop-style locking script for testing.
 * Format: <pubkey> OP_CHECKSIG <field1> <field2> ... OP_DROP/OP_2DROP
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
 * Helper to create a BEEF from a transaction with source transactions properly linked.
 * The transaction's inputs must have sourceTransaction set for proper BEEF construction.
 */
function createBeefWithSources(tx: Transaction): number[] {
  // Use toBEEF() which properly includes all source transactions from inputs
  return tx.toBEEF()
}

describe('BTMS Topic Manager', () => {
  let manager: BTMSTopicManager
  let testPrivKey: PrivateKey
  let testPubKey: PublicKey

  beforeEach(() => {
    manager = new BTMSTopicManager()
    testPrivKey = PrivateKey.fromRandom()
    testPubKey = testPrivKey.toPublicKey()
  })

  describe('Issuance outputs', () => {
    it('Admits issuance output', async () => {
      const lockingScript = createPushDropScript(testPubKey, ['ISSUE', '100'])
      const tx = new Transaction()
      tx.addOutput({ lockingScript, satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [])

      expect(admitted).toEqual({
        outputsToAdmit: [0],
        coinsToRetain: []
      })
    })

    it('Admits issuance output with metadata', async () => {
      const lockingScript = createPushDropScript(testPubKey, ['ISSUE', '100', 'metadata_1'])
      const tx = new Transaction()
      tx.addOutput({ lockingScript, satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [])

      expect(admitted).toEqual({
        outputsToAdmit: [0],
        coinsToRetain: []
      })
    })
  })

  describe('Redeeming issuance outputs', () => {
    it('Redeems an issuance output', async () => {
      // Create source transaction with issuance
      const sourceTx = new Transaction()
      const issuanceScript = createPushDropScript(testPubKey, ['ISSUE', '100'])
      sourceTx.addOutput({ lockingScript: issuanceScript, satoshis: 1000 })

      const sourceTxid = sourceTx.id('hex')

      // Create spending transaction
      const tx = new Transaction()
      tx.addInput({
        sourceTransaction: sourceTx,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      const redeemScript = createPushDropScript(testPubKey, [`${sourceTxid}.0`, '100'])
      tx.addOutput({ lockingScript: redeemScript, satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [0])

      expect(admitted).toEqual({
        outputsToAdmit: [0],
        coinsToRetain: [0]
      })
    })

    it('Redeems an issuance output with metadata', async () => {
      const sourceTx = new Transaction()
      const issuanceScript = createPushDropScript(testPubKey, ['ISSUE', '100', 'metadata_1'])
      sourceTx.addOutput({ lockingScript: issuanceScript, satoshis: 1000 })

      const sourceTxid = sourceTx.id('hex')

      const tx = new Transaction()
      tx.addInput({
        sourceTransaction: sourceTx,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      const redeemScript = createPushDropScript(testPubKey, [`${sourceTxid}.0`, '100', 'metadata_1'])
      tx.addOutput({ lockingScript: redeemScript, satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [0])

      expect(admitted).toEqual({
        outputsToAdmit: [0],
        coinsToRetain: [0]
      })
    })

    it('Will not redeem issuance output if metadata changes', async () => {
      const sourceTx = new Transaction()
      const issuanceScript = createPushDropScript(testPubKey, ['ISSUE', '100', 'metadata_1'])
      sourceTx.addOutput({ lockingScript: issuanceScript, satoshis: 1000 })

      const sourceTxid = sourceTx.id('hex')

      const tx = new Transaction()
      tx.addInput({
        sourceTransaction: sourceTx,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      const redeemScript = createPushDropScript(testPubKey, [`${sourceTxid}.0`, '100', 'metadata_changed'])
      tx.addOutput({ lockingScript: redeemScript, satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [0])

      expect(admitted).toEqual({
        outputsToAdmit: [],
        coinsToRetain: []
      })
    })

    it('Does not redeem issuance output when amount is too large', async () => {
      const sourceTx = new Transaction()
      const issuanceScript = createPushDropScript(testPubKey, ['ISSUE', '100'])
      sourceTx.addOutput({ lockingScript: issuanceScript, satoshis: 1000 })

      const sourceTxid = sourceTx.id('hex')

      const tx = new Transaction()
      tx.addInput({
        sourceTransaction: sourceTx,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      const redeemScript = createPushDropScript(testPubKey, [`${sourceTxid}.0`, '101'])
      tx.addOutput({ lockingScript: redeemScript, satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [0])

      expect(admitted).toEqual({
        outputsToAdmit: [],
        coinsToRetain: []
      })
    })
  })

  describe('Non-issuance outputs', () => {
    it('Redeems a non-issuance output', async () => {
      const sourceTx = new Transaction()
      const sourceScript = createPushDropScript(testPubKey, ['mock_assid.0', '100'])
      sourceTx.addOutput({ lockingScript: sourceScript, satoshis: 1000 })

      const tx = new Transaction()
      tx.addInput({
        sourceTransaction: sourceTx,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      const redeemScript = createPushDropScript(testPubKey, ['mock_assid.0', '100'])
      tx.addOutput({ lockingScript: redeemScript, satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [0])

      expect(admitted).toEqual({
        outputsToAdmit: [0],
        coinsToRetain: [0]
      })
    })

    it('Redeems a non-issuance output with metadata', async () => {
      const sourceTx = new Transaction()
      const sourceScript = createPushDropScript(testPubKey, ['mock_assid.0', '100', 'metadata_1'])
      sourceTx.addOutput({ lockingScript: sourceScript, satoshis: 1000 })

      const tx = new Transaction()
      tx.addInput({
        sourceTransaction: sourceTx,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      const redeemScript = createPushDropScript(testPubKey, ['mock_assid.0', '100', 'metadata_1'])
      tx.addOutput({ lockingScript: redeemScript, satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [0])

      expect(admitted).toEqual({
        outputsToAdmit: [0],
        coinsToRetain: [0]
      })
    })

    it('Will not redeem non-issuance output when metadata changes', async () => {
      const sourceTx = new Transaction()
      const sourceScript = createPushDropScript(testPubKey, ['mock_assid.0', '100', 'metadata_1'])
      sourceTx.addOutput({ lockingScript: sourceScript, satoshis: 1000 })

      const tx = new Transaction()
      tx.addInput({
        sourceTransaction: sourceTx,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      const redeemScript = createPushDropScript(testPubKey, ['mock_assid.0', '100', 'metadata_changed'])
      tx.addOutput({ lockingScript: redeemScript, satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [0])

      expect(admitted).toEqual({
        outputsToAdmit: [],
        coinsToRetain: []
      })
    })

    it('Does not admit non-issuance outputs when amounts are too large', async () => {
      const sourceTx = new Transaction()
      const sourceScript = createPushDropScript(testPubKey, ['mock_assid.0', '100'])
      sourceTx.addOutput({ lockingScript: sourceScript, satoshis: 1000 })

      const tx = new Transaction()
      tx.addInput({
        sourceTransaction: sourceTx,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      const redeemScript = createPushDropScript(testPubKey, ['mock_assid.0', '101'])
      tx.addOutput({ lockingScript: redeemScript, satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [0])

      expect(admitted).toEqual({
        outputsToAdmit: [],
        coinsToRetain: []
      })
    })
  })

  describe('Splitting and merging', () => {
    it('Splits an asset into two outputs', async () => {
      const sourceTx = new Transaction()
      const sourceScript = createPushDropScript(testPubKey, ['mock_assid.0', '100'])
      sourceTx.addOutput({ lockingScript: sourceScript, satoshis: 1000 })

      const tx = new Transaction()
      tx.addInput({
        sourceTransaction: sourceTx,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      tx.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_assid.0', '75']), satoshis: 1000 })
      tx.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_assid.0', '25']), satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [0])

      expect(admitted).toEqual({
        outputsToAdmit: [0, 1],
        coinsToRetain: [0]
      })
    })

    it('Will not split for more than the original amount, only letting the first outputs through', async () => {
      const sourceTx = new Transaction()
      const sourceScript = createPushDropScript(testPubKey, ['mock_assid.0', '100'])
      sourceTx.addOutput({ lockingScript: sourceScript, satoshis: 1000 })

      const tx = new Transaction()
      tx.addInput({
        sourceTransaction: sourceTx,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      tx.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_assid.0', '75']), satoshis: 1000 })
      tx.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_assid.0', '35']), satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [0])

      expect(admitted).toEqual({
        outputsToAdmit: [0],
        coinsToRetain: [0]
      })
    })

    it('Merges two tokens of the same asset into one output', async () => {
      const sourceTx1 = new Transaction()
      sourceTx1.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_assid.0', '100']), satoshis: 1000 })

      const sourceTx2 = new Transaction()
      sourceTx2.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_assid.0', '150']), satoshis: 1000 })

      const tx = new Transaction()
      tx.addInput({
        sourceTransaction: sourceTx1,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      tx.addInput({
        sourceTransaction: sourceTx2,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      tx.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_assid.0', '250']), satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [0, 1])

      expect(admitted).toEqual({
        outputsToAdmit: [0],
        coinsToRetain: [0, 1]
      })
    })

    it('Does not merge two different assets into one output', async () => {
      const sourceTx1 = new Transaction()
      sourceTx1.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_assid1.0', '100']), satoshis: 1000 })

      const sourceTx2 = new Transaction()
      sourceTx2.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_assid2.0', '150']), satoshis: 1000 })

      const tx = new Transaction()
      tx.addInput({
        sourceTransaction: sourceTx1,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      tx.addInput({
        sourceTransaction: sourceTx2,
        sourceOutputIndex: 0,
        unlockingScript: new Script()
      })
      tx.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_assid1.0', '250']), satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [0, 1])

      expect(admitted).toEqual({
        outputsToAdmit: [],
        coinsToRetain: []
      })
    })
  })

  describe('Complex transactions', () => {
    it('Splits one asset, merges a second, issues a third, and transfers a fourth, all in the same transaction', async () => {
      // Source transactions
      const splitSource = new Transaction()
      splitSource.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_split.0', '100']), satoshis: 1000 })

      const merge1Source = new Transaction()
      merge1Source.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_merge.0', '150']), satoshis: 1000 })

      const merge2Source = new Transaction()
      merge2Source.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_merge.0', '150']), satoshis: 1000 })

      const transfer1Source = new Transaction()
      transfer1Source.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_transfer.7', '150']), satoshis: 1000 })

      const transfer2Source = new Transaction()
      transfer2Source.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_transfer.7', '150']), satoshis: 1000 })

      const burnSource = new Transaction()
      burnSource.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_burnme.3', '1']), satoshis: 1000 })

      // Main transaction
      const tx = new Transaction()
      tx.addInput({ sourceTransaction: splitSource, sourceOutputIndex: 0, unlockingScript: new Script() })
      tx.addInput({ sourceTransaction: merge1Source, sourceOutputIndex: 0, unlockingScript: new Script() })
      tx.addInput({ sourceTransaction: merge2Source, sourceOutputIndex: 0, unlockingScript: new Script() })
      tx.addInput({ sourceTransaction: transfer1Source, sourceOutputIndex: 0, unlockingScript: new Script() })
      tx.addInput({ sourceTransaction: transfer2Source, sourceOutputIndex: 0, unlockingScript: new Script() })
      tx.addInput({ sourceTransaction: burnSource, sourceOutputIndex: 0, unlockingScript: new Script() })

      // Outputs: split(75,25), merge(300), issue(500), transfer(250,50)
      tx.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_split.0', '75']), satoshis: 1000 })
      tx.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_split.0', '25']), satoshis: 1000 })
      tx.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_merge.0', '300']), satoshis: 1000 })
      tx.addOutput({ lockingScript: createPushDropScript(testPubKey, ['ISSUE', '500']), satoshis: 1000 })
      tx.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_transfer.7', '250']), satoshis: 1000 })
      tx.addOutput({ lockingScript: createPushDropScript(testPubKey, ['mock_transfer.7', '50']), satoshis: 1000 })

      const beef = createBeefWithSources(tx)
      const admitted = await manager.identifyAdmissibleOutputs(beef, [0, 1, 2, 3, 4, 5])

      expect(admitted).toEqual({
        outputsToAdmit: [0, 1, 2, 3, 4, 5],
        coinsToRetain: [0, 1, 2, 3, 4]
      })
    })
  })
})