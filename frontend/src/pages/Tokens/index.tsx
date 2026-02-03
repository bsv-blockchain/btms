// frontend/src/pages/Tokens/index.tsx

import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Grid,
  Typography,
  Button,
  TableContainer,
  Box,
  LinearProgress,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Container,
  Paper,
  Divider,
  Chip,
  IconButton,
  Tooltip,
  TablePagination,
  ToggleButton,
  ToggleButtonGroup,
  Card,
  CardContent
} from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Img } from '@bsv/uhrp-react'
import SortIcon from '@mui/icons-material/Sort'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import { IdentityCard } from '@bsv/identity-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer } from 'recharts'
import { toast } from 'react-toastify'
import useStyles from './tokens-style'
import Send from '../../components/Send'
import Receive from '../../components/Receive'
import Melt from '../../components/Melt'
import { SatoshiValue, TXIDHexString, WalletCounterparty } from '@bsv/sdk'
import { Asset, btms } from '../../btms'
import { logWithTimestamp } from '../../utils/logging'

interface TokensProps {
  match: {
    params: {
      assetId: string
    }
  }
}

interface TokenTransaction {
  date: string
  timestamp?: number
  amount: number
  txid: TXIDHexString
  counterparty: string
  type?: 'issue' | 'send' | 'receive' | 'melt'
  direction?: 'incoming' | 'outgoing'
  status?: string
}

const TOKENS_DEBUG = true

const TOKENS_SOURCE_TAG = 'frontend/src/btms/index.ts@debug-hmr-39'
const WOC_BASE_URL = 'https://whatsonchain.com/tx/'

function tokensDebug(label: string, ...rest: any[]) {
  if (!TOKENS_DEBUG) return
  //if (label.startsWith('listAssets')) {
  logWithTimestamp(`[BTMS:${TOKENS_SOURCE_TAG}] ${label}`, ...rest)
  //}
}

const formatDate = (tx: TokenTransaction) => {
  if (tx.timestamp) {
    return new Date(tx.timestamp).toLocaleString()
  }
  return tx.date
}

const shortTxid = (txid: string) => {
  if (!txid) return ''
  return `${txid.slice(0, 8)}...${txid.slice(-6)}`
}

const Tokens: React.FC<TokensProps> = ({ match }) => {
  const classes = useStyles()
  let tokenID = match.params.assetId
  if (tokenID) {
    // Replace ALL underscores with dots (not just the first one)
    tokenID = tokenID.replace(/_/g, '.')
  }

  const [walletTokens, setWalletTokens] = useState<Asset[]>([])
  const [token, setToken] = useState<Asset | null>(null)
  const [transactions, setTransactions] = useState<TokenTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [cleaningBadOutputs, setCleaningBadOutputs] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [balanceHistory, setBalanceHistory] = useState<Array<{ date: string; balance: number }>>([])

  // Calculate balance history from transactions
  const calculateBalanceHistory = (txs: TokenTransaction[], currentBalance: number) => {
    if (txs.length === 0) {
      return [{
        date: new Date().toLocaleDateString(),
        balance: currentBalance,
        timestamp: Date.now()
      }]
    }

    // Sort by timestamp ascending (oldest first)
    const sorted = [...txs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

    // Start from 0 and work forward through transactions
    let runningBalance = 0
    const history: Array<{ date: string; balance: number; timestamp: number }> = []

    // Add starting point at 0
    if (sorted.length > 0 && sorted[0].timestamp) {
      history.push({
        date: new Date(sorted[0].timestamp).toLocaleDateString(),
        balance: 0,
        timestamp: sorted[0].timestamp - 1
      })
    }

    // Work forward through transactions, applying each one
    for (const tx of sorted) {
      runningBalance += tx.amount

      history.push({
        date: tx.timestamp ? new Date(tx.timestamp).toLocaleDateString() : 'Unknown',
        balance: runningBalance,
        timestamp: tx.timestamp || 0
      })
    }

    // Add current point if it's different from last transaction
    if (history.length > 0 && history[history.length - 1].balance !== currentBalance) {
      history.push({
        date: new Date().toLocaleDateString(),
        balance: currentBalance,
        timestamp: Date.now()
      })
    }

    return history
  }

  useEffect(() => {
    btms.onAssetsChanged(assets => setWalletTokens(assets))
  }, [])

  const refresh = async () => {
    const assets = await btms.listAssets()
    const found = assets!.find(x => x.assetId === tokenID)
    if (!found) {
      setError(true)
      setLoading(false)
      toast.error('Asset not found!')
      return
    }
    setToken(found)

    if (typeof btms.getTransactions === 'function') {
      const txResult = await btms.getTransactions(tokenID, 100, 0)
      // Sort by timestamp descending (latest first)
      const sorted = (txResult.transactions || []).sort((a, b) => {
        const timeA = a.timestamp || 0
        const timeB = b.timestamp || 0
        return sortOrder === 'desc' ? timeB - timeA : timeA - timeB
      })
      setTransactions(sorted)

      // Calculate and set balance history
      const history = calculateBalanceHistory(sorted, found.balance)
      setBalanceHistory(history)
    } else {
      setTransactions([])
      setBalanceHistory([])
    }
  }

  const handleCleanBadOutputs = async () => {
    if (cleaningBadOutputs) return
    const confirmed = window.confirm('Remove corrupted token outputs from your wallet? This cannot be undone.')
    if (!confirmed) return

    try {
      setCleaningBadOutputs(true)
      const result = await btms.relinquishBadOutputs()

      if (result.relinquished.length === 0 && result.failed.length === 0) {
        toast.info('No corrupted outputs found')
      } else {
        if (result.relinquished.length > 0) {
          toast.success(`Removed ${result.relinquished.length} corrupted output${result.relinquished.length === 1 ? '' : 's'}`)
        }
        if (result.failed.length > 0) {
          toast.error(`Failed to remove ${result.failed.length} output${result.failed.length === 1 ? '' : 's'}`)
        }
      }

      await refresh()
    } catch (err) {
      console.error(err)
      toast.error('Failed to remove corrupted outputs')
    } finally {
      setCleaningBadOutputs(false)
    }
  }

  useEffect(() => {
    ; (async () => {
      await refresh()
      setLoading(false)
    })()
  }, [tokenID])

  if (error) {
    return (
      <div>
        <Container>
          <Grid container>
            <Grid item className={classes.back_button}>
              <Button component={Link} to="/" color="secondary">
                <ArrowBackIosNewIcon className={classes.back_icon} /> My Tokens
              </Button>
            </Grid>
          </Grid>
          <Box>
            <br />
            <br />
            <Typography align="center">Asset not found.</Typography>
          </Box>
        </Container>
      </div>
    )
  }

  if (loading || !token) {
    return (
      <div>
        <Container>
          <Grid container>
            <Grid item className={classes.back_button}>
              <Button component={Link} to="/" color="secondary">
                <ArrowBackIosNewIcon className={classes.back_icon} /> My Tokens
              </Button>
            </Grid>
          </Grid>
          <Box>
            <br />
            <br />
            <LinearProgress color="secondary" />
          </Box>
        </Container>
      </div>
    )
  }

  // Safely pull “description” if it exists on this asset
  const tokenDescription = (token as any).description || 'Token details'
  const tokenBalance = Number(token.balance) || 0

  // Parse metadata to get icon URL if available
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
    <div>
      <Container maxWidth="lg" sx={{ pb: 8 }}>
        <Grid container alignItems="center" className={classes.back_button}>
          <Button component={Link} to="/" color="secondary">
            <ArrowBackIosNewIcon className={classes.back_icon} /> My Tokens
          </Button>
        </Grid>

        <Paper elevation={0} sx={{ p: { xs: 3, md: 4 }, mt: 2 }}>
          <Grid container spacing={4}>
            {/* Left side - Token info */}
            <Grid item xs={12} md={4}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: '12px',
                    background: 'rgba(0, 0, 0, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden'
                  }}
                >
                  {iconURL ? (
                    <Img src={iconURL} alt={token.name || token.assetId} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {(token.name || token.assetId).slice(0, 1).toUpperCase()}
                    </Typography>
                  )}
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                  {token.name || 'Token'}
                </Typography>
              </Box>

              <Typography variant="h3" sx={{ fontWeight: 700, mb: 3 }}>
                {tokenBalance} units
              </Typography>

              <Box sx={{ display: 'flex', gap: 1.5 }}>
                <Send assetId={token.assetId} asset={token} onReloadNeeded={refresh} />
                <Receive assetId={token.assetId} asset={token} onReloadNeeded={refresh} />
                <Melt assetId={token.assetId} asset={token} onReloadNeeded={refresh} />
              </Box>
              <Box sx={{ mt: 2 }}>
                <Button
                  variant="outlined"
                  color="warning"
                  size="small"
                  startIcon={<DeleteSweepIcon />}
                  onClick={handleCleanBadOutputs}
                  disabled={cleaningBadOutputs}
                >
                  {cleaningBadOutputs ? 'Cleaning...' : 'Remove corrupted outputs'}
                </Button>
              </Box>
            </Grid>

            {/* Right side - Balance history graph */}
            <Grid item xs={12} md={8}>
              <Box sx={{ mb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Balance history
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  30 days
                </Typography>
              </Box>
              {balanceHistory.length > 0 ? (
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={balanceHistory}>
                    <defs>
                      <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#666' }}
                      stroke="#bdbdbd"
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#666' }}
                      stroke="#bdbdbd"
                      tickLine={false}
                      axisLine={false}
                    />
                    <ChartTooltip
                      contentStyle={{ backgroundColor: 'white', border: '1px solid #ccc' }}
                      formatter={(value: number) => [`${value} units`, 'Balance']}
                    />
                    <Line
                      type="monotone"
                      dataKey="balance"
                      stroke="#06b6d4"
                      strokeWidth={2}
                      dot={false}
                      fill="url(#colorBalance)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Box sx={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.50', borderRadius: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    No transaction history available
                  </Typography>
                </Box>
              )}
            </Grid>
          </Grid>
        </Paper>

        <Grid container direction="column" sx={{ pt: 2 }}>
          <Grid item sx={{ pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Transactions
            </Typography>
            <ToggleButtonGroup
              value={sortOrder}
              exclusive
              onChange={(e, newOrder) => {
                if (newOrder !== null) {
                  setSortOrder(newOrder)
                  const sorted = [...transactions].sort((a, b) => {
                    const timeA = a.timestamp || 0
                    const timeB = b.timestamp || 0
                    return newOrder === 'desc' ? timeB - timeA : timeA - timeB
                  })
                  setTransactions(sorted)
                }
              }}
              size="small"
            >
              <ToggleButton value="desc">
                <SortIcon fontSize="small" sx={{ mr: 0.5 }} />
                Newest
              </ToggleButton>
              <ToggleButton value="asc">
                <SortIcon fontSize="small" sx={{ mr: 0.5, transform: 'scaleY(-1)' }} />
                Oldest
              </ToggleButton>
            </ToggleButtonGroup>
          </Grid>
          <TableContainer component={Paper} elevation={0}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell align="left">Date</TableCell>
                  <TableCell align="left">Transaction Amount</TableCell>
                  <TableCell align="right">Counterparty</TableCell>
                  <TableCell align="right">Transaction ID</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {transactions.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((tx, i) => {
                  const isCredit = tx.amount > 0
                  const typeLabel = tx.type === 'issue' ? 'Issued'
                    : tx.type === 'send' ? 'Sent'
                      : tx.type === 'receive' ? 'Received'
                        : tx.type === 'melt' ? 'Melted'
                          : tx.direction === 'incoming' ? 'Received' : 'Sent'
                  const txidLabel = shortTxid(tx.txid)
                  const wocUrl = `${WOC_BASE_URL}${tx.txid}`

                  return (
                    <TableRow key={i}>
                      <TableCell align="left" style={{ width: '0.1em' }}>
                        {formatDate(tx)}
                      </TableCell>
                      <TableCell align="left">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip
                            label={typeLabel}
                            size="small"
                            color={isCredit ? 'success' : 'error'}
                            sx={{ minWidth: 70 }}
                          />
                          <Typography
                            sx={{
                              fontWeight: 600,
                              color: isCredit ? 'success.main' : 'error.main'
                            }}
                          >
                            {isCredit ? '+' : ''}{tx.amount}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        {tx.counterparty && tx.counterparty !== 'N/A' ? (
                          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <IdentityCard identityKey={tx.counterparty} />
                          </Box>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            N/A
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                          <Typography
                            component="a"
                            href={wocUrl}
                            target="_blank"
                            rel="noreferrer"
                            variant="body2"
                            sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'primary.main', textDecoration: 'none' }}
                          >
                            {txidLabel}
                          </Typography>
                          <Tooltip title="Copy TXID">
                            <IconButton
                              size="small"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(tx.txid)
                                  toast.success('TXID copied')
                                } catch (error) {
                                  toast.error('Failed to copy TXID')
                                }
                              }}
                            >
                              <ContentCopyIcon fontSize="inherit" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <TablePagination
              rowsPerPageOptions={[5, 10, 25, 50]}
              component="div"
              count={transactions.length}
              rowsPerPage={rowsPerPage}
              page={page}
              onPageChange={(e, newPage) => setPage(newPage)}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10))
                setPage(0)
              }}
            />
          </TableContainer>
        </Grid>
      </Container>
    </div>
  )
}

export default Tokens
