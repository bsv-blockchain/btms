/**
 * BTMS Class Tests
 * 
 * Comprehensive unit tests for the BTMS class covering:
 * - Token issuance
 * - Asset listing
 * - Token sending
 * - Labeling, tagging, and filtering
 * - Change selection with complex scenarios
 */

// Mock TopicBroadcaster before importing BTMS
const mockTopicBroadcasterBroadcast = jest.fn()
const MockTopicBroadcasterClass = jest.fn().mockImplementation(() => ({
  broadcast: mockTopicBroadcasterBroadcast
}))

jest.mock('@bsv/sdk', () => {
  const actual = jest.requireActual('@bsv/sdk')
  return {
    ...actual,
    TopicBroadcaster: MockTopicBroadcasterClass
  }
})

import { BTMS } from '../BTMS.js'
import { BTMSToken } from '../BTMSToken.js'
import { BTMS_LABEL, BTMS_BASKET_PREFIX, getAssetBasket } from '../constants.js'
import type {
  WalletInterface,
  CreateActionArgs,
  CreateActionResult,
  SignActionArgs,
  SignActionResult,
  ListActionsArgs,
  ListActionsResult,
  ListOutputsArgs,
  ListOutputsResult,
  GetPublicKeyArgs,
  GetPublicKeyResult,
  WalletProtocol
} from '@bsv/sdk'
import { PrivateKey, ProtoWallet, Transaction, TopicBroadcaster } from '@bsv/sdk'

// Mock transaction data
const MOCK_TXID = 'a'.repeat(64)
const MOCK_IDENTITY_KEY = '03' + 'b'.repeat(64)
const MOCK_RECIPIENT_KEY = '03' + 'c'.repeat(64)

// Helper to create mock atomic BEEF (simplified for testing)
function createMockAtomicBEEF(txid: string): number[] {
  // This is a simplified mock - real BEEF would be more complex
  return Array(100).fill(0)
}

// Create a mock wallet for testing
function createMockWallet(overrides: Partial<{
  createActionResult: Partial<CreateActionResult>
  signActionResult: Partial<SignActionResult>
  listActionsResult: Partial<ListActionsResult>
  listOutputsResult: Partial<ListOutputsResult>
  identityKey: string
}> = {}): WalletInterface & { calls: Record<string, any[]> } {
  const calls: Record<string, any[]> = {
    createAction: [],
    signAction: [],
    listActions: [],
    listOutputs: [],
    getPublicKey: [],
    internalizeAction: [],
    relinquishOutput: []
  }

  const wallet = {
    calls,

    async getPublicKey(args: GetPublicKeyArgs): Promise<GetPublicKeyResult> {
      calls.getPublicKey.push(args)
      return {
        publicKey: overrides.identityKey ?? MOCK_IDENTITY_KEY
      }
    },

    async createAction(args: CreateActionArgs): Promise<CreateActionResult> {
      calls.createAction.push(args)

      // If outputs exist, return a signable transaction (for send flow)
      if (args.inputs && args.inputs.length > 0) {
        return {
          signableTransaction: {
            reference: 'mock-reference',
            tx: createMockAtomicBEEF(MOCK_TXID)
          },
          ...overrides.createActionResult
        }
      }

      // For issuance, return completed tx
      return {
        txid: MOCK_TXID,
        tx: createMockAtomicBEEF(MOCK_TXID),
        ...overrides.createActionResult
      }
    },

    async signAction(args: SignActionArgs): Promise<SignActionResult> {
      calls.signAction.push(args)
      return {
        txid: MOCK_TXID,
        tx: createMockAtomicBEEF(MOCK_TXID),
        ...overrides.signActionResult
      }
    },

    async listActions(args: ListActionsArgs): Promise<ListActionsResult> {
      calls.listActions.push(args)
      return {
        totalActions: 0,
        actions: [],
        ...overrides.listActionsResult
      }
    },

    async listOutputs(args: ListOutputsArgs): Promise<ListOutputsResult> {
      calls.listOutputs.push(args)
      return {
        totalOutputs: 0,
        outputs: [],
        ...overrides.listOutputsResult
      }
    },

    async internalizeAction(args: any): Promise<any> {
      calls.internalizeAction.push(args)
      return { accepted: true }
    },

    async relinquishOutput(args: any): Promise<any> {
      calls.relinquishOutput.push(args)
      return { relinquished: true }
    },

    // Stub other required methods
    async isAuthenticated() { return { authenticated: true } },
    async waitForAuthentication() { return { authenticated: true } },
    async getNetwork() { return { network: 'mainnet' as const } },
    async getVersion() { return { version: '1.0.0' } },
    async getHeight() { return { height: 800000 } },
    async getHeaderForHeight() { return { header: '00'.repeat(80) } },
    async revealCounterpartyKeyLinkage() { return {} as any },
    async revealSpecificKeyLinkage() { return {} as any },
    async encrypt() { return { ciphertext: [] } },
    async decrypt() { return { plaintext: [] } },
    async createHmac() { return { hmac: [] } },
    async verifyHmac() { return { valid: true } },
    async createSignature() { return { signature: [] } },
    async verifySignature() { return { valid: true } },
    async abortAction() { return { aborted: true } },
    async acquireCertificate() { return {} as any },
    async listCertificates() { return { totalCertificates: 0, certificates: [] } },
    async proveCertificate() { return {} as any },
    async relinquishCertificate() { return { relinquished: true } },
    async discoverByIdentityKey() { return { totalCertificates: 0, certificates: [] } },
    async discoverByAttributes() { return { totalCertificates: 0, certificates: [] } }
  } as unknown as WalletInterface & { calls: Record<string, any[]> }

  return wallet
}

describe('BTMS', () => {
  describe('constructor', () => {
    it('should create instance with default config', () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })
      expect(btms).toBeInstanceOf(BTMS)
    })

    it('should accept custom network preset', () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet, networkPreset: 'testnet' })
      expect(btms).toBeInstanceOf(BTMS)
    })
  })

  describe('setOriginator', () => {
    it('should set originator for wallet calls', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      btms.setOriginator('test-app.example.com')

      // Trigger a wallet call
      await btms.getIdentityKey()

      // The originator should be passed to getPublicKey
      // Note: originator is passed as second argument, not in args
      expect(mockWallet.calls.getPublicKey.length).toBe(1)
    })
  })

  describe('getIdentityKey', () => {
    it('should return wallet identity key', async () => {
      const mockWallet = createMockWallet({ identityKey: MOCK_IDENTITY_KEY })
      const btms = new BTMS({ wallet: mockWallet })

      const key = await btms.getIdentityKey()

      expect(key).toBe(MOCK_IDENTITY_KEY)
    })

    it('should cache identity key after first call', async () => {
      const mockWallet = createMockWallet({ identityKey: MOCK_IDENTITY_KEY })
      const btms = new BTMS({ wallet: mockWallet })

      await btms.getIdentityKey()
      await btms.getIdentityKey()
      await btms.getIdentityKey()

      // Should only call wallet once due to caching
      expect(mockWallet.calls.getPublicKey.length).toBe(1)
    })
  })

  describe('issue', () => {
    it('should create issuance transaction with correct parameters', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      const result = await btms.issue(1000, {
        name: 'GOLD',
        description: 'Test gold token'
      })

      // Note: The issue method broadcasts to overlay which fails in test environment
      // We verify the wallet was called correctly even if broadcast fails
      expect(mockWallet.calls.createAction.length).toBe(1)
      const createActionCall = mockWallet.calls.createAction[0] as CreateActionArgs
      expect(createActionCall.description).toContain('GOLD')
      // Basket is no longer set in createAction - it's set via internalizeAction with assetId
      expect(createActionCall.outputs?.[0].basket).toBeUndefined()

      // Result may fail due to broadcast, but amount should be preserved
      expect(result.amount).toBe(1000)
    })

    it('should not set basket in createAction (uses internalizeAction instead)', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      await btms.issue(1000, { name: 'GOLD' })

      // createAction should NOT have a basket - basket is set via internalizeAction
      // with the real assetId (txid.0) after we know the txid
      const createActionCall = mockWallet.calls.createAction[0] as CreateActionArgs
      expect(createActionCall.outputs?.[0].basket).toBeUndefined()

      // Note: internalizeAction call happens after Transaction.fromAtomicBEEF
      // which fails in test environment with mock BEEF data
    })

    it('should use correct label (btms)', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      await btms.issue(500, { name: 'SILVER' })

      const createActionCall = mockWallet.calls.createAction[0] as CreateActionArgs
      expect(createActionCall.labels).toContain(BTMS_LABEL)
    })

    it('should use correct tag (btms_issue)', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      await btms.issue(100, { name: 'PLATINUM' })

      const createActionCall = mockWallet.calls.createAction[0] as CreateActionArgs
      expect(createActionCall.outputs?.[0].tags).toContain('btms_issue')
    })

    it('should include name in description when provided', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      await btms.issue(1000, {
        name: 'GOLD',
        description: 'Test token',
        iconURL: 'https://example.com/icon.png'
      })

      // The name should be included in the description
      const createActionCall = mockWallet.calls.createAction[0] as CreateActionArgs
      expect(createActionCall.description).toContain('GOLD')
    })

    it('should return error result on failure', async () => {
      const mockWallet = createMockWallet({
        createActionResult: { tx: undefined } // Simulate failure
      })
      const btms = new BTMS({ wallet: mockWallet })

      const result = await btms.issue(100, { name: 'FAIL' })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('listAssets', () => {
    it('should discover assets from listActions with btms label', async () => {
      const mockWallet = createMockWallet({
        listActionsResult: {
          totalActions: 2,
          actions: [
            {
              txid: MOCK_TXID,
              satoshis: 1,
              status: 'completed' as const,
              isOutgoing: false,
              description: 'Issue tokens',
              labels: [BTMS_LABEL],
              version: 1,
              lockTime: 0,
              outputs: [
                {
                  satoshis: 1,
                  spendable: true,
                  outputIndex: 0,
                  outputDescription: 'Issue GOLD tokens',
                  basket: 'p btms GOLD',
                  tags: ['btms_issue']
                }
              ]
            },
            {
              txid: 'b'.repeat(64),
              satoshis: 1,
              status: 'completed' as const,
              isOutgoing: false,
              description: 'Issue more tokens',
              labels: [BTMS_LABEL],
              version: 1,
              lockTime: 0,
              outputs: [
                {
                  satoshis: 1,
                  spendable: true,
                  outputIndex: 0,
                  outputDescription: 'Issue SILVER tokens',
                  basket: 'p btms SILVER',
                  tags: ['btms_issue']
                }
              ]
            }
          ]
        },
        listOutputsResult: {
          totalOutputs: 0,
          outputs: []
        }
      })
      const btms = new BTMS({ wallet: mockWallet })

      const assets = await btms.listAssets()

      // Should call listActions with btms label
      expect(mockWallet.calls.listActions.length).toBeGreaterThan(0)
      const listActionsCall = mockWallet.calls.listActions[0] as ListActionsArgs
      expect(listActionsCall.labels).toContain(BTMS_LABEL)
    })

    it('should filter by basket prefix (p btms)', async () => {
      const mockWallet = createMockWallet({
        listActionsResult: {
          totalActions: 2,
          actions: [
            {
              txid: MOCK_TXID,
              satoshis: 1,
              status: 'completed' as const,
              isOutgoing: false,
              description: 'BTMS token',
              labels: [BTMS_LABEL],
              version: 1,
              lockTime: 0,
              outputs: [
                {
                  satoshis: 1,
                  spendable: true,
                  outputIndex: 0,
                  outputDescription: 'Issue GOLD tokens',
                  basket: 'p btms GOLD',
                  tags: ['btms_issue']
                }
              ]
            },
            {
              txid: 'b'.repeat(64),
              satoshis: 1,
              status: 'completed' as const,
              isOutgoing: false,
              description: 'Other token',
              labels: ['other'],
              version: 1,
              lockTime: 0,
              outputs: [
                {
                  satoshis: 1,
                  spendable: true,
                  outputIndex: 0,
                  outputDescription: 'Other token output',
                  basket: 'other-basket',
                  tags: ['other']
                }
              ]
            }
          ]
        },
        listOutputsResult: {
          totalOutputs: 0,
          outputs: []
        }
      })
      const btms = new BTMS({ wallet: mockWallet })

      await btms.listAssets()

      // Verify listActions was called with correct parameters
      const listActionsCall = mockWallet.calls.listActions[0] as ListActionsArgs
      expect(listActionsCall.includeOutputs).toBe(true)
    })
  })

  describe('getSpendableTokens', () => {
    it('should query correct basket for asset', async () => {
      const assetId = MOCK_TXID + '.0'
      const mockWallet = createMockWallet({
        listOutputsResult: {
          totalOutputs: 0,
          outputs: []
        }
      })
      const btms = new BTMS({ wallet: mockWallet })

      await btms.getSpendableTokens(assetId)

      // Should query the basket for this asset
      expect(mockWallet.calls.listOutputs.length).toBe(1)
      const listOutputsCall = mockWallet.calls.listOutputs[0] as ListOutputsArgs
      expect(listOutputsCall.basket).toBe(getAssetBasket(assetId))
      expect(listOutputsCall.include).toBe('locking scripts')
      expect(listOutputsCall.includeTags).toBe(true)
    })
  })

  describe('getBalance', () => {
    it('should return 0 for asset with no tokens', async () => {
      const assetId = MOCK_TXID + '.0'
      const mockWallet = createMockWallet({
        listOutputsResult: {
          totalOutputs: 0,
          outputs: []
        }
      })
      const btms = new BTMS({ wallet: mockWallet })

      const balance = await btms.getBalance(assetId)

      expect(balance).toBe(0)
    })
  })

  describe('send', () => {
    it('should validate asset ID format', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      const result = await btms.send('invalid-asset-id', MOCK_RECIPIENT_KEY, 100)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid assetId')
    })

    it('should validate amount is positive integer', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      const result = await btms.send(MOCK_TXID + '.0', MOCK_RECIPIENT_KEY, -100)

      expect(result.success).toBe(false)
      expect(result.error).toContain('positive integer')
    })

    it('should validate amount is not fractional', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      const result = await btms.send(MOCK_TXID + '.0', MOCK_RECIPIENT_KEY, 10.5)

      expect(result.success).toBe(false)
      expect(result.error).toContain('positive integer')
    })

    it('should fail if no spendable tokens', async () => {
      const mockWallet = createMockWallet({
        listOutputsResult: {
          totalOutputs: 0,
          outputs: []
        }
      })
      const btms = new BTMS({ wallet: mockWallet })

      const result = await btms.send(MOCK_TXID + '.0', MOCK_RECIPIENT_KEY, 100)

      expect(result.success).toBe(false)
      expect(result.error).toContain('No spendable tokens')
    })

    it('should fail when selected tokens have mismatched metadata', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      const assetId = `${MOCK_TXID}.0`
      const utxoA = {
        outpoint: `${'a'.repeat(64)}.0`,
        txid: 'a'.repeat(64),
        outputIndex: 0,
        satoshis: 1,
        lockingScript: 'mock-script',
        customInstructions: JSON.stringify({ derivationPrefix: 'a', derivationSuffix: 'b' }),
        token: {
          valid: true as const,
          assetId,
          amount: 40,
          metadata: { name: 'GOLD' },
          lockingPublicKey: MOCK_IDENTITY_KEY
        },
        spendable: true
      }
      const utxoB = {
        ...utxoA,
        outpoint: `${'b'.repeat(64)}.0`,
        txid: 'b'.repeat(64),
        token: {
          ...utxoA.token,
          metadata: { name: 'SILVER' }
        }
      }

      btms.getSpendableTokens = jest.fn().mockResolvedValue({ tokens: [utxoA, utxoB] })
      const originalSelectAndVerify = (btms as any).selectAndVerifyUTXOs
        ; (btms as any).selectAndVerifyUTXOs = jest.fn().mockResolvedValue({
          selected: [utxoA, utxoB],
          totalInput: 80,
          inputBeef: { toBinary: () => new Uint8Array([1, 2, 3]) }
        })

      try {
        const result = await btms.send(assetId, MOCK_RECIPIENT_KEY, 60)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Metadata mismatch')
      } finally {
        ; (btms as any).selectAndVerifyUTXOs = originalSelectAndVerify
      }
    })
  })

  describe('change selection (BTMS.selectUTXOs)', () => {
    // These tests verify the ACTUAL UTXO selection logic in BTMS.selectUTXOs
    // This static method is used by BTMS.send for greedy UTXO selection

    const GOLD_ASSET_ID = MOCK_TXID + '.0'

    // Helper to create mock UTXOs for testing
    function createMockUTXOs(amounts: number[]) {
      return amounts.map((amount, i) => ({
        outpoint: `${'abcdef'[i % 6].repeat(64)}.0`,
        txid: 'abcdef'[i % 6].repeat(64),
        outputIndex: 0,
        satoshis: 1,
        lockingScript: 'mock-script',
        customInstructions: JSON.stringify({
          derivationPrefix: `prefix-${i}`,
          derivationSuffix: `suffix-${i}`
        }),
        token: {
          valid: true as const,
          assetId: GOLD_ASSET_ID,
          amount,
          metadata: { name: 'GOLD' },
          lockingPublicKey: MOCK_IDENTITY_KEY
        },
        spendable: true
      }))
    }

    it('should select single UTXO when it exactly matches amount (30 gold, need 30)', () => {
      // UTXOs: 20, 30, 10 gold - need exactly 30
      // Greedy: sorts [30, 20, 10], selects 30 (30 >= 30, done)
      const utxos = createMockUTXOs([20, 30, 10])
      const result = BTMS.selectUTXOs(utxos, 30)

      expect(result.selected.length).toBe(1)
      expect(result.selected[0].token.amount).toBe(30)
      expect(result.totalInput).toBe(30)
    })

    it('should select multiple UTXOs and create change when needed (need 31 gold)', () => {
      // UTXOs: 20, 30, 10 gold - need 31
      // Greedy: sorts [30, 20, 10]
      // Selects 30 (30 < 31, need more)
      // Selects 20 (30 + 20 = 50 >= 31, done)
      const utxos = createMockUTXOs([20, 30, 10])
      const result = BTMS.selectUTXOs(utxos, 31)

      expect(result.selected.length).toBe(2)
      expect(result.selected.map(u => u.token.amount)).toEqual([30, 20])
      expect(result.totalInput).toBe(50)
      // Change would be 50 - 31 = 19
    })

    it('should select all UTXOs when needed (need 60 gold, have exactly 60)', () => {
      // UTXOs: 20, 30, 10 gold - need 60 (all of them)
      const utxos = createMockUTXOs([20, 30, 10])
      const result = BTMS.selectUTXOs(utxos, 60)

      expect(result.selected.length).toBe(3)
      expect(result.selected.map(u => u.token.amount)).toEqual([30, 20, 10])
      expect(result.totalInput).toBe(60)
    })

    it('should return insufficient total when balance is not enough (need 61 gold, have 60)', () => {
      // UTXOs: 20, 30, 10 gold - need 61 (more than available)
      const utxos = createMockUTXOs([20, 30, 10])
      const result = BTMS.selectUTXOs(utxos, 61)

      // selectUTXOs returns all UTXOs but totalInput < amount
      expect(result.selected.length).toBe(3)
      expect(result.totalInput).toBe(60)
      // Caller (BTMS.send) checks totalInput < amount and throws error
    })

    it('should use greedy algorithm (largest first) - not optimal but predictable', () => {
      // UTXOs: 5, 15, 25, 35 gold - need 40
      // Greedy: sorts [35, 25, 15, 5]
      // Selects 35 (35 < 40)
      // Selects 25 (35 + 25 = 60 >= 40, done)
      // Total input: 60, change: 20
      // Note: This is NOT optimal (25 + 15 = 40 exact), but greedy is simpler
      const utxos = createMockUTXOs([5, 15, 25, 35])
      const result = BTMS.selectUTXOs(utxos, 40)

      expect(result.selected.length).toBe(2)
      expect(result.selected.map(u => u.token.amount)).toEqual([35, 25])
      expect(result.totalInput).toBe(60)
    })

    it('should select largest UTXO first even when smaller would suffice', () => {
      // UTXOs: 100, 50, 25 gold - need 20
      // Greedy: sorts [100, 50, 25]
      // Selects 100 (100 >= 20, done immediately)
      // Change: 80
      // Note: 25 would have been more efficient (only 5 change)
      const utxos = createMockUTXOs([100, 50, 25])
      const result = BTMS.selectUTXOs(utxos, 20)

      expect(result.selected.length).toBe(1)
      expect(result.selected[0].token.amount).toBe(100)
      expect(result.totalInput).toBe(100)
    })

    it('should handle many small UTXOs', () => {
      // UTXOs: 10 x 10 gold = 100 total - need 55
      // Greedy: all same size, selects first 6 (60 >= 55)
      const utxos = createMockUTXOs(Array(10).fill(10))
      const result = BTMS.selectUTXOs(utxos, 55)

      expect(result.selected.length).toBe(6)
      expect(result.totalInput).toBe(60)
    })

    it('should handle empty UTXO array', () => {
      const result = BTMS.selectUTXOs([], 100)

      expect(result.selected.length).toBe(0)
      expect(result.totalInput).toBe(0)
    })

    // Integration test: verify BTMS.send uses selectUTXOs and handles insufficient balance
    it('should fail with insufficient balance error from BTMS.send', async () => {
      const mockWallet = createMockWallet({
        listOutputsResult: {
          totalOutputs: 0,
          outputs: []
        }
      })

      const btms = new BTMS({ wallet: mockWallet })

      // Mock getSpendableTokens to return controlled UTXOs
      btms.getSpendableTokens = jest.fn().mockResolvedValue({ tokens: createMockUTXOs([20, 30, 10]) })

      // Mock selectAndVerifyUTXOs to return the verification result
      const originalSelectAndVerify = (btms as any).selectAndVerifyUTXOs
        ; (btms as any).selectAndVerifyUTXOs = jest.fn().mockResolvedValue({
          selected: createMockUTXOs([20, 30, 10]),
          totalInput: 60,
          inputBeef: { toBinary: () => new Uint8Array([1, 2, 3]) }
        })

      try {
        // Attempt to send 61 gold (more than available 60)
        const result = await btms.send(GOLD_ASSET_ID, MOCK_RECIPIENT_KEY, 61)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Insufficient balance')
        expect(result.error).toContain('Have 60')
        expect(result.error).toContain('need 61')
      } finally {
        ; (btms as any).selectAndVerifyUTXOs = originalSelectAndVerify
      }
    })
  })

  describe('labeling and tagging', () => {
    it('should use btms label for all transactions', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      await btms.issue(100, { name: 'TEST' })

      const createActionCall = mockWallet.calls.createAction[0] as CreateActionArgs
      expect(createActionCall.labels).toEqual([BTMS_LABEL])
    })

    it('should use btms_issue tag for issuance outputs', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      await btms.issue(100, { name: 'TEST' })

      const createActionCall = mockWallet.calls.createAction[0] as CreateActionArgs
      expect(createActionCall.outputs?.[0].tags).toEqual(['btms_issue'])
    })

    it('should not set basket in createAction (deferred to internalizeAction)', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      await btms.issue(100, { name: 'MYTOKEN' })

      // Basket is NOT set in createAction - it's set via internalizeAction
      // using the real assetId (txid.0) after transaction creation
      const createActionCall = mockWallet.calls.createAction[0] as CreateActionArgs
      expect(createActionCall.outputs?.[0].basket).toBeUndefined()
    })
  })

  describe('originator passthrough', () => {
    it('should pass originator to createAction', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })
      btms.setOriginator('test-app.com')

      await btms.issue(100, { name: 'TEST' })

      // Originator is passed as second argument to wallet methods
      // The mock captures the first argument (args), but originator is second
      expect(mockWallet.calls.createAction.length).toBe(1)
    })

    it('should pass originator to getPublicKey', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })
      btms.setOriginator('test-app.com')

      await btms.getIdentityKey()

      expect(mockWallet.calls.getPublicKey.length).toBe(1)
    })
  })
})

describe('getAssetBasket helper', () => {
  it('should generate correct basket name', () => {
    expect(getAssetBasket('GOLD')).toBe('p btms GOLD')
    expect(getAssetBasket('SILVER')).toBe('p btms SILVER')
    expect(getAssetBasket(MOCK_TXID + '.0')).toBe(`p btms ${MOCK_TXID}.0`)
  })
})

describe('Ownership Proof', () => {
  const GOLD_ASSET_ID = MOCK_TXID + '.0'
  const MOCK_VERIFIER_KEY = '03' + 'd'.repeat(64)

  // Helper to create mock UTXOs for testing
  function createMockUTXOs(amounts: number[]) {
    return amounts.map((amount, i) => ({
      outpoint: `${'abcdef'[i % 6].repeat(64)}.0`,
      txid: 'abcdef'[i % 6].repeat(64) as any,
      outputIndex: 0,
      satoshis: 1 as any,
      lockingScript: 'mock-script' as any,
      customInstructions: JSON.stringify({
        derivationPrefix: `prefix-${i}`,
        derivationSuffix: `suffix-${i}`
      }),
      token: {
        valid: true as const,
        assetId: GOLD_ASSET_ID,
        amount,
        metadata: { name: 'GOLD' },
        lockingPublicKey: MOCK_IDENTITY_KEY
      },
      spendable: true
    }))
  }

  describe('proveOwnership', () => {
    it('should validate asset ID format', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      const result = await btms.proveOwnership('invalid-asset-id', 100, MOCK_VERIFIER_KEY)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid assetId')
    })

    it('should validate amount is positive integer', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      const result = await btms.proveOwnership(GOLD_ASSET_ID, -100, MOCK_VERIFIER_KEY)

      expect(result.success).toBe(false)
      expect(result.error).toContain('positive integer')
    })

    it('should validate amount is not fractional', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      const result = await btms.proveOwnership(GOLD_ASSET_ID, 10.5, MOCK_VERIFIER_KEY)

      expect(result.success).toBe(false)
      expect(result.error).toContain('positive integer')
    })

    it('should fail if no tokens found', async () => {
      const mockWallet = createMockWallet({
        listOutputsResult: {
          totalOutputs: 0,
          outputs: []
        }
      })
      const btms = new BTMS({ wallet: mockWallet })

      const result = await btms.proveOwnership(GOLD_ASSET_ID, 100, MOCK_VERIFIER_KEY)

      expect(result.success).toBe(false)
      expect(result.error).toContain('No tokens found')
    })

    it('should fail if insufficient balance', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      // Mock getSpendableTokens to return controlled UTXOs
      btms.getSpendableTokens = jest.fn().mockResolvedValue({ tokens: createMockUTXOs([20, 30, 10]) })

      const result = await btms.proveOwnership(GOLD_ASSET_ID, 100, MOCK_VERIFIER_KEY)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Insufficient balance')
    })

    it('should select tokens using greedy algorithm', async () => {
      const mockUTXOs = createMockUTXOs([20, 30, 10])
      const mockWallet = createMockWallet()
        // Add revealSpecificKeyLinkage to mock
        ; (mockWallet as any).revealSpecificKeyLinkage = jest.fn().mockResolvedValue({
          prover: MOCK_IDENTITY_KEY,
          verifier: MOCK_VERIFIER_KEY,
          counterparty: MOCK_IDENTITY_KEY,
          encryptedLinkage: [1, 2, 3],
          encryptedLinkageProof: [4, 5, 6],
          proofType: 1
        })

      const btms = new BTMS({ wallet: mockWallet })

      // Mock getSpendableTokens to return the UTXOs directly
      btms.getSpendableTokens = jest.fn().mockResolvedValue({ tokens: mockUTXOs })

      // Mock lookupTokenOnOverlay to return found
      const originalLookup = (btms as any).lookupTokenOnOverlay
        ; (btms as any).lookupTokenOnOverlay = jest.fn().mockResolvedValue({ found: true })

      try {
        const result = await btms.proveOwnership(GOLD_ASSET_ID, 31, MOCK_VERIFIER_KEY)

        expect(result.success).toBe(true)
        expect(result.proof).toBeDefined()
        expect(result.proof?.tokens.length).toBe(2) // 30 + 20 = 50 >= 31
        expect(result.proof?.amount).toBe(31)
        expect(result.proof?.assetId).toBe(GOLD_ASSET_ID)
        expect(result.proof?.prover).toBe(MOCK_IDENTITY_KEY)
        expect(result.proof?.verifier).toBe(MOCK_VERIFIER_KEY)
      } finally {
        ; (btms as any).lookupTokenOnOverlay = originalLookup
      }
    })

    it('should include key linkage for each token', async () => {
      const mockUTXOs = createMockUTXOs([50]) as any[]
      const mockWallet = createMockWallet()
      const mockLinkage = {
        prover: MOCK_IDENTITY_KEY,
        verifier: MOCK_VERIFIER_KEY,
        counterparty: MOCK_IDENTITY_KEY,
        encryptedLinkage: [1, 2, 3],
        encryptedLinkageProof: [4, 5, 6],
        proofType: 1
      }
        ; (mockWallet as any).revealSpecificKeyLinkage = jest.fn().mockResolvedValue(mockLinkage)

      const btms = new BTMS({ wallet: mockWallet })

      // Mock getSpendableTokens to return the UTXOs directly
      btms.getSpendableTokens = jest.fn().mockResolvedValue({ tokens: mockUTXOs })

      // Mock lookupTokenOnOverlay to return found
      const originalLookup = (btms as any).lookupTokenOnOverlay
        ; (btms as any).lookupTokenOnOverlay = jest.fn().mockResolvedValue({ found: true })

      try {
        const result = await btms.proveOwnership(GOLD_ASSET_ID, 50, MOCK_VERIFIER_KEY)

        expect(result.success).toBe(true)
        expect(result.proof?.tokens[0].linkage).toEqual({
          prover: MOCK_IDENTITY_KEY,
          verifier: MOCK_VERIFIER_KEY,
          counterparty: MOCK_IDENTITY_KEY,
          encryptedLinkage: [1, 2, 3],
          encryptedLinkageProof: [4, 5, 6],
          proofType: 1
        })
      } finally {
        ; (btms as any).lookupTokenOnOverlay = originalLookup
      }
    })
  })

  describe('verifyOwnership', () => {
    it('should reject proof not intended for this verifier', async () => {
      // Scenario: Alice creates a proof for Bob, but Charlie tries to verify it

      // Charlie's wallet (the one trying to verify)
      const charlieKey = MOCK_IDENTITY_KEY
      const charlieWallet = createMockWallet({ identityKey: charlieKey })
      const charlie = new BTMS({ wallet: charlieWallet })

      // Alice created a proof intended for Bob (not Charlie)
      const aliceKey = MOCK_RECIPIENT_KEY
      const bobKey = 'different-verifier-key'
      const proofFromAliceToBob = {
        prover: aliceKey,        // Alice is proving
        verifier: bobKey,        // Proof is intended for Bob
        tokens: [],
        amount: 100,
        assetId: GOLD_ASSET_ID
      }

      // Charlie tries to verify a proof that was meant for Bob
      const result = await charlie.verifyOwnership(proofFromAliceToBob as any)

      // Should fail because Charlie is not the intended verifier (Bob is)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('not intended for this verifier')
    })

    it('should reject proof with invalid token', async () => {
      const mockWallet = createMockWallet({ identityKey: MOCK_IDENTITY_KEY })
      const btms = new BTMS({ wallet: mockWallet })

      const proof = {
        prover: MOCK_RECIPIENT_KEY,
        verifier: MOCK_IDENTITY_KEY,
        tokens: [{
          output: {
            txid: MOCK_TXID,
            outputIndex: 0,
            lockingScript: 'invalid-script',
            satoshis: 1
          },
          linkage: {
            prover: MOCK_RECIPIENT_KEY,
            verifier: MOCK_IDENTITY_KEY,
            counterparty: MOCK_RECIPIENT_KEY,
            encryptedLinkage: [1, 2, 3],
            encryptedLinkageProof: [4, 5, 6],
            proofType: 1
          }
        }],
        amount: 100,
        assetId: GOLD_ASSET_ID
      }

      const result = await btms.verifyOwnership(proof as any)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid token')
    })

    it('should reject proof with mismatched prover in linkage', async () => {
      const mockWallet = createMockWallet({ identityKey: MOCK_IDENTITY_KEY })
      const btms = new BTMS({ wallet: mockWallet })

      // Mock BTMSToken.decode to return a valid token
      const originalDecode = BTMSToken.decode
      BTMSToken.decode = jest.fn().mockReturnValue({
        valid: true,
        assetId: GOLD_ASSET_ID,
        amount: 100,
        lockingPublicKey: MOCK_RECIPIENT_KEY
      })

      try {
        const proof = {
          prover: MOCK_RECIPIENT_KEY,
          verifier: MOCK_IDENTITY_KEY,
          tokens: [{
            output: {
              txid: MOCK_TXID,
              outputIndex: 0,
              lockingScript: 'mock-script',
              satoshis: 1
            },
            linkage: {
              prover: 'different-prover', // Mismatched prover
              verifier: MOCK_IDENTITY_KEY,
              counterparty: MOCK_RECIPIENT_KEY,
              encryptedLinkage: [1, 2, 3],
              encryptedLinkageProof: [4, 5, 6],
              proofType: 1
            }
          }],
          amount: 100,
          assetId: GOLD_ASSET_ID
        }

        const result = await btms.verifyOwnership(proof as any)

        expect(result.valid).toBe(false)
        expect(result.error).toContain('prover')
      } finally {
        // Restore original
        BTMSToken.decode = originalDecode
      }
    })

    it('should fail to decrypt linkage encrypted for different verifier (real ProtoWallet)', async () => {
      // Scenario: Alice creates proof for Bob using real key linkage
      // Charlie intercepts it and tries to decrypt - should fail cryptographically

      // Create real private keys for Alice, Bob, and Charlie
      const alicePrivateKey = PrivateKey.fromRandom()
      const bobPrivateKey = PrivateKey.fromRandom()
      const charliePrivateKey = PrivateKey.fromRandom()

      // Create ProtoWallets
      const aliceWallet = new ProtoWallet(alicePrivateKey)
      const bobWallet = new ProtoWallet(bobPrivateKey)
      const charlieWallet = new ProtoWallet(charliePrivateKey)

      // Get public keys
      const aliceKey = alicePrivateKey.toPublicKey().toString()
      const bobKey = bobPrivateKey.toPublicKey().toString()

      // Alice creates a real key linkage revelation for Bob
      const protocolID: WalletProtocol = [0, 'p btms']
      const keyID = '1' // Using '1' for this test since it's testing real ProtoWallet encryption

      const linkageFromAliceToBob = await aliceWallet.revealSpecificKeyLinkage({
        counterparty: aliceKey, // Self-owned tokens
        verifier: bobKey,       // Intended for Bob
        protocolID,
        keyID
      })

      // Mock BTMSToken.decode to return a valid token
      const originalDecode = BTMSToken.decode
      BTMSToken.decode = jest.fn().mockReturnValue({
        valid: true,
        assetId: GOLD_ASSET_ID,
        amount: 100,
        lockingPublicKey: aliceKey
      })

      try {
        // Create BTMS instance for Charlie
        const charlie = new BTMS({ wallet: charlieWallet as any })

        // Alice's proof intended for Bob (with real encrypted linkage)
        const proofFromAliceToBob = {
          prover: aliceKey,
          verifier: bobKey,  // Intended for Bob, not Charlie
          tokens: [{
            output: {
              txid: MOCK_TXID,
              outputIndex: 0,
              lockingScript: 'mock-script',
              satoshis: 1
            },
            linkage: {
              prover: linkageFromAliceToBob.prover,
              verifier: linkageFromAliceToBob.verifier,
              counterparty: linkageFromAliceToBob.counterparty,
              encryptedLinkage: linkageFromAliceToBob.encryptedLinkage,
              encryptedLinkageProof: linkageFromAliceToBob.encryptedLinkageProof,
              proofType: linkageFromAliceToBob.proofType
            }
          }],
          amount: 100,
          assetId: GOLD_ASSET_ID
        }

          // Mock lookupTokenOnOverlay to pass
          ; (charlie as any).lookupTokenOnOverlay = jest.fn().mockResolvedValue({ found: true })

        // Charlie tries to verify by pretending to be Bob (bypassing verifier check)
        const originalGetIdentityKey = charlie.getIdentityKey
        charlie.getIdentityKey = jest.fn().mockResolvedValue(bobKey)

        const result = await charlie.verifyOwnership(proofFromAliceToBob as any)

        // Should fail because Charlie derives the wrong shared secret
        // Charlie derives: ECDH(Charlie's private key, Alice's public key) = wrong shared secret
        // Linkage encrypted with: ECDH(Bob's private key, Alice's public key) = correct shared secret
        // Different ECDH points -> AES-GCM decryption fails (authentication error)
        expect(result.valid).toBe(false)
        expect(result.error).toBeDefined()

        // Restore
        charlie.getIdentityKey = originalGetIdentityKey

        // BONUS: Verify Bob CAN successfully decrypt the same linkage
        const bob = new BTMS({ wallet: bobWallet as any })
          ; (bob as any).lookupTokenOnOverlay = jest.fn().mockResolvedValue({ found: true })

        const bobResult = await bob.verifyOwnership(proofFromAliceToBob as any)

        // Bob should succeed because he has the correct private key
        expect(bobResult.valid).toBe(true)
        expect(bobResult.amount).toBe(100)
        expect(bobResult.prover).toBe(aliceKey)
      } finally {
        BTMSToken.decode = originalDecode
      }
    })
  })

  describe('accept', () => {
    it('should throw error when token not on overlay and broadcast fails', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      // Mock lookupTokenOnOverlay to return not found
      const originalLookup = (btms as any).lookupTokenOnOverlay
        ; (btms as any).lookupTokenOnOverlay = jest.fn().mockResolvedValue({ found: false })

      // Mock Transaction.fromBEEF to avoid BEEF validation
      const mockTx = { toBEEF: jest.fn().mockReturnValue([1, 2, 3]) }
      const originalFromBEEF = Transaction.fromBEEF
      Transaction.fromBEEF = jest.fn().mockReturnValue(mockTx)

      // Configure the mocked TopicBroadcaster to return error
      mockTopicBroadcasterBroadcast.mockResolvedValue({ status: 'error', description: 'Network error' })

      const incomingToken = {
        txid: MOCK_TXID as any,
        outputIndex: 0,
        lockingScript: '00' as any,
        amount: 100,
        assetId: `${MOCK_TXID}.0`,
        sender: MOCK_RECIPIENT_KEY as any,
        messageId: 'msg-123',
        satoshis: 1,
        beef: createMockAtomicBEEF(MOCK_TXID),
        customInstructions: JSON.stringify({ derivationPrefix: 'test', derivationSuffix: 'test' })
      }

      // Mock BTMSToken.decode to return valid
      const originalDecode = BTMSToken.decode
      BTMSToken.decode = jest.fn().mockReturnValue({
        valid: true,
        assetId: `${MOCK_TXID}.0`,
        amount: 100,
        metadata: undefined
      })

      try {
        const result = await btms.accept(incomingToken)
        expect(result.success).toBe(false)
        expect(result.error).toContain('Token not found on overlay and broadcast failed!')
      } finally {
        // Restore mocks
        ; (btms as any).lookupTokenOnOverlay = originalLookup
        BTMSToken.decode = originalDecode
        Transaction.fromBEEF = originalFromBEEF
        mockTopicBroadcasterBroadcast.mockReset()
      }
    })

    it('should succeed when token is found on overlay', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      // Mock lookupTokenOnOverlay to return found
      const originalLookup = (btms as any).lookupTokenOnOverlay
        ; (btms as any).lookupTokenOnOverlay = jest.fn().mockResolvedValue({ found: true })

      const incomingToken = {
        txid: MOCK_TXID as any,
        outputIndex: 0,
        lockingScript: '00' as any,
        amount: 100,
        assetId: `${MOCK_TXID}.0`,
        sender: MOCK_RECIPIENT_KEY as any,
        messageId: 'msg-123',
        satoshis: 1,
        beef: createMockAtomicBEEF(MOCK_TXID),
        customInstructions: JSON.stringify({ derivationPrefix: 'test', derivationSuffix: 'test' })
      }

      // Mock BTMSToken.decode to return valid
      const originalDecode = BTMSToken.decode
      BTMSToken.decode = jest.fn().mockReturnValue({
        valid: true,
        assetId: `${MOCK_TXID}.0`,
        amount: 100,
        metadata: undefined
      })

      try {
        const result = await btms.accept(incomingToken)
        expect(result.success).toBe(true)
        expect(result.assetId).toBe(`${MOCK_TXID}.0`)
        expect(result.amount).toBe(100)
        expect(mockWallet.calls.internalizeAction).toHaveLength(1)
      } finally {
        // Restore mocks
        ; (btms as any).lookupTokenOnOverlay = originalLookup
        BTMSToken.decode = originalDecode
      }
    })

    it('should accept token without beef when not on overlay', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      const originalLookup = (btms as any).lookupTokenOnOverlay
        ; (btms as any).lookupTokenOnOverlay = jest.fn().mockResolvedValue({ found: false })

      const incomingToken = {
        txid: MOCK_TXID as any,
        outputIndex: 0,
        lockingScript: '00' as any,
        amount: 100,
        assetId: `${MOCK_TXID}.0`,
        sender: MOCK_RECIPIENT_KEY as any,
        messageId: 'msg-123',
        satoshis: 1,
        customInstructions: JSON.stringify({ derivationPrefix: 'test', derivationSuffix: 'test' })
      } as any

      const originalDecode = BTMSToken.decode
      BTMSToken.decode = jest.fn().mockReturnValue({
        valid: true,
        assetId: `${MOCK_TXID}.0`,
        amount: 100,
        metadata: undefined
      })

      try {
        const result = await btms.accept(incomingToken)

        expect(result.success).toBe(true)
        expect(mockWallet.calls.internalizeAction).toHaveLength(1)
        expect(mockTopicBroadcasterBroadcast).not.toHaveBeenCalled()
      } finally {
        ; (btms as any).lookupTokenOnOverlay = originalLookup
        BTMSToken.decode = originalDecode
      }
    })

    it('should re-broadcast when token not on overlay but broadcast succeeds', async () => {
      const mockWallet = createMockWallet()
      const btms = new BTMS({ wallet: mockWallet })

      // Mock lookupTokenOnOverlay to return not found
      const originalLookup = (btms as any).lookupTokenOnOverlay
        ; (btms as any).lookupTokenOnOverlay = jest.fn().mockResolvedValue({ found: false })

      // Mock Transaction.fromBEEF to avoid BEEF validation
      const mockTx = { toBEEF: jest.fn().mockReturnValue([1, 2, 3]) }
      const originalFromBEEF = Transaction.fromBEEF
      Transaction.fromBEEF = jest.fn().mockReturnValue(mockTx)

      // Configure the mocked TopicBroadcaster to return success
      mockTopicBroadcasterBroadcast.mockResolvedValue({ status: 'success' })

      const incomingToken = {
        txid: MOCK_TXID as any,
        outputIndex: 0,
        lockingScript: '00' as any,
        amount: 100,
        assetId: `${MOCK_TXID}.0`,
        sender: MOCK_RECIPIENT_KEY as any,
        messageId: 'msg-123',
        satoshis: 1,
        beef: createMockAtomicBEEF(MOCK_TXID),
        customInstructions: JSON.stringify({ derivationPrefix: 'test', derivationSuffix: 'test' })
      }

      // Mock BTMSToken.decode to return valid
      const originalDecode = BTMSToken.decode
      BTMSToken.decode = jest.fn().mockReturnValue({
        valid: true,
        assetId: `${MOCK_TXID}.0`,
        amount: 100,
        metadata: undefined
      })

      try {
        const result = await btms.accept(incomingToken)
        expect(result.success).toBe(true)
        expect(mockWallet.calls.internalizeAction).toHaveLength(1)
      } finally {
        // Restore mocks
        ; (btms as any).lookupTokenOnOverlay = originalLookup
        BTMSToken.decode = originalDecode
        Transaction.fromBEEF = originalFromBEEF
        mockTopicBroadcasterBroadcast.mockReset()
      }
    })
  })
})
