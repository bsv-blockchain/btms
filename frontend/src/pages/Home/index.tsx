import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Grid,
  Typography,
  Button,
  LinearProgress,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Container,
  Box,
  Paper,
  Divider,
  Chip
} from '@mui/material'
import { Img } from '@bsv/uhrp-react'
import { toast } from 'react-toastify'
import useStyles from './home-style'
import Receive from '../../components/Receive'
import Send from '../../components/Send'
import { Asset, btms } from '../../btms/index'
import { logWithTimestamp } from '../../utils/logging'

interface HomeProps {
  history: {
    push: (path: string) => void
  }
}

const HOME_DEBUG = false
const HOME_SOURCE_TAG = 'frontend/src/pages/Home/index.tsx'

function homeDebug(label: string, ...rest: any[]) {
  if (!HOME_DEBUG) return
  logWithTimestamp(`[BTMS:${HOME_SOURCE_TAG}] ${label}`, ...rest)
}

const INCOMING_REFRESH_MS = 30000

const Home: React.FC<HomeProps> = ({ history }) => {
  const classes = useStyles()

  const [walletTokens, setWalletTokens] = useState<Asset[]>([])
  const [tokensLoading, setTokensLoading] = useState(true)

  const [incomingByAsset, setIncomingByAsset] = useState<Record<string, number>>({})
  const [incomingAmountsByAsset, setIncomingAmountsByAsset] = useState<Record<string, number>>({})

  const lastIncomingFetchRef = useRef<number>(0)

  useEffect(() => {
    btms.onAssetsChanged(assets => setWalletTokens(assets))
  }, [])

  const refreshAssets = async () => {
    try {
      const assets = await btms.listAssets()
      homeDebug('refreshAssets got', assets)
      setWalletTokens(assets)
    } catch (err: any) {
      homeDebug('refreshAssets ERROR', err?.message)
      toast.error(err?.message || 'Error refreshing assets')
    }
  }

  const refreshIncoming = async (force = false) => {
    const now = Date.now()
    if (!force && now - lastIncomingFetchRef.current < INCOMING_REFRESH_MS) {
      return
    }

    try {
      const incoming = await btms.listIncomingPayments()
      if (!Array.isArray(incoming)) {
        lastIncomingFetchRef.current = now
        return
      }

      const countMap: Record<string, number> = {}
      const amountMap: Record<string, number> = {}

      for (const msg of incoming) {
        const assetId = (msg as any)?.assetId
        if (!assetId) continue

        countMap[assetId] = (countMap[assetId] || 0) + 1

        const rawAmount = (msg as any).amount ?? 0
        const numericAmount = Number(rawAmount) || 0
        amountMap[assetId] = (amountMap[assetId] || 0) + numericAmount
      }

      homeDebug('refreshIncoming: maps built', { countMap, amountMap })

      setIncomingByAsset(countMap)
      setIncomingAmountsByAsset(amountMap)
      lastIncomingFetchRef.current = now
    } catch (err: any) {
      homeDebug('refreshIncoming ERROR', err?.message)
      lastIncomingFetchRef.current = now
    }
  }

  useEffect(() => {
    ; (async () => {
      homeDebug('mount: loading')
      try {
        await refreshAssets()
        await refreshIncoming(true)
      } catch (err: any) {
        toast.error(err?.message || 'Something went wrong!')
      } finally {
        setTokensLoading(false)
      }
    })()
  }, [])

  // --------------------------------------------------------------
  // MERGE wallet tokens + incoming messages (STRICT, NO STALE DATA)
  // --------------------------------------------------------------
  // --------------------------------------------------------------
  // MERGE wallet tokens + incoming messages (STRICT, CORRECT TYPES)
  // --------------------------------------------------------------
  const mergedTokens: Asset[] = useMemo(() => {
    const byId: Record<string, Asset> = {}

    // ----------------------------------------------------------
    // 1. Normal wallet tokens (always present)
    // ----------------------------------------------------------
    for (const w of walletTokens) {
      const incomingCount = incomingByAsset[w.assetId] ?? 0
      const incomingAmount = incomingAmountsByAsset[w.assetId] ?? 0

      const hasPendingIncoming: boolean = incomingCount > 0
      const incoming: boolean = hasPendingIncoming

      byId[w.assetId] = {
        ...w,
        hasPendingIncoming,
        incoming, // BOOLEAN (TS FIXED)
        incomingAmount // NUMBER (safe)
      }
    }

    // ----------------------------------------------------------
    // 2. Incoming for tokens NOT already in walletTokens
    // ----------------------------------------------------------
    for (const assetId of Object.keys(incomingByAsset)) {
      if (!byId[assetId]) {
        const incomingCount = incomingByAsset[assetId] ?? 0
        const incomingAmount = incomingAmountsByAsset[assetId] ?? 0

        if (incomingCount <= 0) continue

        const hasPendingIncoming: boolean = true
        const incoming: boolean = true

        byId[assetId] = {
          assetId,
          name: assetId,
          balance: 0,
          metadata: '',
          hasPendingIncoming,
          incoming, // BOOLEAN
          incomingAmount // NUMBER
        }
      }
    }

    // ----------------------------------------------------------
    // 3. Final sorting: tokens WITH real incoming first
    // ----------------------------------------------------------
    const arr = Object.values(byId).sort((a, b) => {
      const aInc = a.incoming ? 1 : 0
      const bInc = b.incoming ? 1 : 0
      if (aInc !== bInc) return bInc - aInc
      return a.assetId.localeCompare(b.assetId)
    })

    homeDebug('mergedTokens (TYPES FIXED)', { merged: arr })
    return arr
  }, [walletTokens, incomingByAsset, incomingAmountsByAsset])

  const totalBalance = useMemo(() => {
    return mergedTokens.reduce((sum, token) => sum + (Number(token.balance) || 0), 0)
  }, [mergedTokens])

  const totalIncoming = useMemo(() => {
    return Object.values(incomingAmountsByAsset).reduce((sum, amount) => sum + (Number(amount) || 0), 0)
  }, [incomingAmountsByAsset])

  return (
    <div>
      <Container maxWidth="lg" sx={{ pb: 8 }}>
        <Grid container spacing={4} className={classes.title}>
          <Grid item xs={12} md={7}>
            <Typography variant="h2" sx={{ fontWeight: 700 }}>
              Asset Vault
            </Typography>
            <Typography variant="h6" color="text.secondary" sx={{ mt: 1, maxWidth: 520 }}>
              Manage real-world assets with instant transfers, incoming receipts, and transparent history.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, mt: 3, flexWrap: 'wrap' }}>
              <Button component={Link} to="/mint" variant="contained" color="primary">
                Issue New Asset
              </Button>
              <Button component={Link} to="/mint" variant="outlined" color="secondary">
                Upload Inventory
              </Button>
            </Box>
          </Grid>
          <Grid item xs={12} md={5}>
            <Paper elevation={0} sx={{ p: 3, background: 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(16px)' }}>
              <Typography variant="overline" color="text.secondary">
                Portfolio Overview
              </Typography>
              <Typography variant="h4" sx={{ mt: 1 }}>
                {totalBalance} units
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Total balance across {mergedTokens.length} assets
              </Typography>
              <Divider sx={{ my: 2 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip label={`${totalIncoming} incoming`} color="secondary" size="small" />
                <Typography variant="body2" color="text.secondary">
                  Pending incoming transfers
                </Typography>
              </Box>
            </Paper>
          </Grid>
        </Grid>

        <Grid container alignItems="center" className={classes.table_title} justifyContent="space-between">
          <Grid item>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              My Assets
            </Typography>
          </Grid>
          <Grid item>
            <Button component={Link} to="/mint" variant="outlined" color="secondary">
              + Issue Asset
            </Button>
          </Grid>
        </Grid>

        <Grid container direction="column">
          <TableContainer component={Paper} elevation={0} sx={{ mt: 2 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell align="left" colSpan={2}>
                    Asset
                  </TableCell>
                  <TableCell align="right">
                    Balance
                  </TableCell>
                  <TableCell align="right">
                    Transfer
                  </TableCell>
                  <TableCell align="right">
                    Incoming
                  </TableCell>
                </TableRow>
              </TableHead>

              {tokensLoading ? (
                <TableBody>
                  <TableRow />
                </TableBody>
              ) : (
                <TableBody>
                  {mergedTokens.map((token, i) => {
                    const incomingCount = incomingByAsset[token.assetId] || 0
                    const incomingAmount = incomingAmountsByAsset[token.assetId] || 0

                    // Use token.balance directly - it's already set from walletTokens in mergedTokens
                    const hasWalletBalance = token.balance > 0
                    const walletBalance = token.balance

                    const incomingOnly = !hasWalletBalance && incomingCount > 0
                    const hasPendingIncoming = !!token.hasPendingIncoming || incomingCount > 0

                    const displayBalance = walletBalance
                    const incomingBadge = hasPendingIncoming ? incomingCount : 0
                    const incomingAmountForRow = hasPendingIncoming ? incomingAmount : 0

                    const balanceNode = hasWalletBalance ? (
                      displayBalance
                    ) : (
                      <span style={{ opacity: 0.5 }}>{displayBalance}</span>
                    )

                    homeDebug('rowState', {
                      assetId: token.assetId,
                      hasWalletBalance,
                      walletBalance,
                      incomingCount,
                      incomingAmount,
                      tokenHasPendingIncoming: token.hasPendingIncoming,
                      hasPendingIncoming,
                      incomingOnly
                    })

                    let iconURL: string | undefined
                    if (token.metadata) {
                      try {
                        const parsed = JSON.parse(token.metadata)
                        if (parsed && typeof parsed.iconURL === 'string') {
                          iconURL = parsed.iconURL
                        }
                      } catch {
                        iconURL = undefined
                      }
                    }

                    return (
                      <TableRow key={i} className={classes.link}>
                        <TableCell
                          align="left"
                          style={{ cursor: 'pointer' }}
                          onClick={() => history.push(`/tokens/${token.assetId.replace('.', '_')}`)}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Box
                              sx={{
                                width: 40,
                                height: 40,
                                borderRadius: '12px',
                                background: 'rgba(15, 23, 42, 0.08)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                overflow: 'hidden'
                              }}
                            >
                              {iconURL ? (
                                <Img src={iconURL} alt={token.name || token.assetId} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <Typography variant="subtitle2" color="text.secondary">
                                  {(token.name || token.assetId).slice(0, 2).toUpperCase()}
                                </Typography>
                              )}
                            </Box>
                            <Box>
                              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                                {token.name || token.assetId}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {token.assetId}
                              </Typography>
                            </Box>
                          </Box>
                        </TableCell>

                        <TableCell
                          align="left"
                          style={{ cursor: 'pointer' }}
                          onClick={() => history.push(`/tokens/${token.assetId.replace('.', '_')}`)}
                        >
                          <Typography variant="body2" color="text.secondary">
                            View details
                          </Typography>
                        </TableCell>

                        <TableCell align="right">{balanceNode}</TableCell>

                        <TableCell align="right">
                          {hasWalletBalance ? (
                            <Send
                              assetId={token.assetId}
                              asset={token}
                              onReloadNeeded={async () => {
                                await refreshAssets()
                                await refreshIncoming(true)
                              }}
                            />
                          ) : (
                            <Button
                              variant="outlined"
                              size="small"
                              disabled
                              sx={{ opacity: 0.4, cursor: 'not-allowed' }}
                            >
                              Transfer
                            </Button>
                          )}
                        </TableCell>

                        {/* RECEIVE COLUMN — FIXED */}
                        {/* RECEIVE COLUMN – correct disabled style */}
                        <TableCell align="right">
                          {hasPendingIncoming ? (
                            <Receive
                              assetId={token.assetId}
                              asset={token}
                              badge={incomingBadge}
                              incomingAmount={incomingAmountForRow}
                              onReloadNeeded={async () => {
                                await refreshAssets()
                                await refreshIncoming(true)
                              }}
                              {...(incomingOnly ? { fromMessageBoxOnly: true } : {})}
                            />
                          ) : (
                            <Button
                              variant="outlined"
                              size="small"
                              disabled
                              sx={{ opacity: 0.4, cursor: 'not-allowed' }}
                            >
                              —
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              )}
            </Table>
          </TableContainer>
        </Grid>

        {tokensLoading && (
          <Box sx={{ mt: 4, textAlign: 'center' }}>
            <Typography sx={{ mb: 2 }}>Loading tokens...</Typography>
            <LinearProgress color="secondary" />
          </Box>
        )}

        {!tokensLoading && mergedTokens.length === 0 && (
          <Box sx={{ mt: 4, textAlign: 'center' }}>
            <Typography sx={{ mb: 2 }}>No assets yet.</Typography>
            <Button component={Link} to="/mint" variant="outlined" color="secondary">
              + Issue Asset
            </Button>
          </Box>
        )}
      </Container>
    </div>
  )
}

export default Home
