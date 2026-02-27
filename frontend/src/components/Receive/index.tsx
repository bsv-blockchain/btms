import React, { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Badge,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Paper,
  Typography,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  IconButton,
  CircularProgress,
  Box,
  Chip
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import RefreshIcon from '@mui/icons-material/Refresh'
import { Img } from '@bsv/uhrp-react'
import { toast } from 'react-toastify'
import { btms, IncomingToken } from '../../btms'
import { AssetView } from '../../btms/types'
import { SatoshiValue } from '@bsv/sdk'
import { formatBtmsError } from '../../utils/formatBtmsError'

type ReceiveProps = {
  assetId?: string
  asset?: AssetView
  badge?: number | boolean
  incomingAmount?: SatoshiValue
  onReloadNeeded?: () => Promise<void> | void
}

const parseIncomingMetadata = (metadata: unknown): Record<string, unknown> | undefined => {
  if (!metadata) return undefined

  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
    } catch {
      return undefined
    }
  }

  if (typeof metadata === 'object') {
    return metadata as Record<string, unknown>
  }

  return undefined
}

const getMetadataString = (metadata: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

const Receive: React.FC<ReceiveProps> = ({
  assetId,
  asset,
  badge = false,
  incomingAmount,
  onReloadNeeded = () => { }
}) => {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [identityKey, setIdentityKey] = useState<string | null>(null)
  const [incoming, setIncoming] = useState<IncomingToken[]>([])

  // -------------------------
  // 1) Load identity key
  // -------------------------
  useEffect(() => {
    let cancelled = false

    const loadIdentityKey = async () => {
      try {
        if (typeof window === 'undefined') {
          if (!cancelled) setIdentityKey('')
          return
        }

        const key = await btms.getIdentityKey()

        if (!cancelled) setIdentityKey(key)
      } catch {
        if (!cancelled) setIdentityKey('')
      }
    }

    loadIdentityKey()
    return () => {
      cancelled = true
    }
  }, [])

  // -------------------------
  // 2) Load incoming payments
  // -------------------------
  const loadIncoming = useCallback(async (desiredAssetId?: string) => {
    setLoading(true)
    try {
      const msgs = await btms.listIncoming(desiredAssetId)
      const clean: IncomingToken[] = Array.isArray(msgs) ? msgs : []
      setIncoming(clean)
    } catch (err: unknown) {
      toast.error(formatBtmsError(err, 'Failed to load incoming payments'))
    } finally {
      setLoading(false)
    }
  }, [])

  const handleOpen = async () => {
    setOpen(true)
    await loadIncoming(assetId)
  }

  const handleClose = () => setOpen(false)

  const handleCopy = () => {
    if (!identityKey) return
    if (!navigator?.clipboard?.writeText) {
      toast.error('Clipboard not available')
      return
    }
    navigator.clipboard.writeText(identityKey)
      .then(() => toast.success('Identity key copied'))
      .catch(() => toast.error('Failed to copy identity key'))
  }

  const handleRefresh = async () => {
    await loadIncoming(assetId)
    await Promise.resolve(onReloadNeeded())
  }

  const handleAccept = async (payment: IncomingToken) => {
    try {
      setLoading(true)
      await btms.accept(payment)
      await loadIncoming(assetId)
      await Promise.resolve(onReloadNeeded())
      toast.success(`${payment.amount} ${asset?.name ?? ''} accepted successfully!`)
      setOpen(false)
    } catch (err: any) {
      toast.error(formatBtmsError(err, 'Failed to accept payment'))
    } finally {
      setLoading(false)
    }
  }

  const handleRefund = async (payment: IncomingToken) => {
    try {
      setLoading(true)
      await btms.refundIncoming(payment)
      await loadIncoming(assetId)
      await Promise.resolve(onReloadNeeded())
      toast.success(`${payment.amount} ${asset?.name ?? ''} refunded successfully!`)
      setOpen(false)
    } catch (err: any) {
      toast.error(formatBtmsError(err, 'Failed to refund payment'))
    } finally {
      setLoading(false)
    }
  }

  // badge logic
  const currentCount = incoming.length
  const badgeVisible =
    typeof badge === 'number' ? badge > 0 : typeof incomingAmount === 'number' ? incomingAmount > 0 : !!badge

  const resolvedAssetMetadata = useMemo(() => {
    for (const payment of incoming) {
      const parsed = parseIncomingMetadata(payment.metadata)
      if (!parsed) continue

      const name = getMetadataString(parsed, 'name')
      const description = getMetadataString(parsed, 'description')
      const iconURL = getMetadataString(parsed, 'iconURL')

      if (name || description || iconURL) {
        return { name, description, iconURL }
      }
    }

    return undefined
  }, [incoming])

  const resolvedAssetName = asset?.name ?? resolvedAssetMetadata?.name ?? assetId ?? 'Asset'
  const resolvedAssetDescription = asset?.description ?? resolvedAssetMetadata?.description
  const resolvedAssetIconURL = asset?.iconURL ?? resolvedAssetMetadata?.iconURL
  const ownsAssetAlready = Number(asset?.balance ?? 0) > 0

  const identityDisplay =
    identityKey === null ? '(loading...)' : identityKey === '' ? '(no identity from wallet)' : identityKey

  return (
    <>
      <Badge color="error" variant={badgeVisible ? 'dot' : 'standard'}>
        <Button variant="outlined" color="secondary" onClick={handleOpen} sx={{ minWidth: 100 }}>
          Receive
        </Button>
      </Badge>

      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="lg" aria-labelledby="receive-dialog-title">
        <DialogTitle id="receive-dialog-title">Incoming {resolvedAssetName}</DialogTitle>

        <DialogContent dividers>
          <Grid container direction="column" spacing={2}>
            <Grid item>
              <Typography variant="subtitle1">Your Identity Key</Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Share this with anyone who needs to transfer assets to you.
              </Typography>

              <Paper
                variant="outlined"
                sx={{
                  p: 1,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <Typography variant="body2" sx={{ wordBreak: 'break-all', mr: 1 }}>
                  {identityDisplay}
                </Typography>
                <IconButton size="small" onClick={handleCopy}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Paper>
            </Grid>

            <Grid item sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="subtitle1">
                Pending transfers for <strong>{resolvedAssetName}</strong>
              </Typography>
              <Button startIcon={<RefreshIcon />} disabled={loading} onClick={handleRefresh}>
                Refresh
              </Button>
            </Grid>

            <Grid item>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  {resolvedAssetIconURL ? (
                    <Img
                      src={resolvedAssetIconURL}
                      alt={resolvedAssetName}
                      style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover' }}
                    />
                  ) : null}
                  <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <Typography variant="subtitle2">{resolvedAssetName}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                      Asset ID: {assetId ?? incoming[0]?.assetId ?? '(unknown)'}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    color={ownsAssetAlready ? 'secondary' : 'warning'}
                    label={ownsAssetAlready ? 'Owned + incoming' : 'Incoming only'}
                  />
                </Box>
                {resolvedAssetDescription && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {resolvedAssetDescription}
                  </Typography>
                )}
              </Paper>
            </Grid>

            <Grid item>
              <Typography variant="caption" color="text.secondary">
                {currentCount} message{currentCount === 1 ? '' : 's'} &nbsp;·&nbsp; total:&nbsp;
                {incoming.reduce((sum, p) => sum + (p.amount || 0), 0)}
              </Typography>
            </Grid>

            <Grid item>
              {loading && incoming.length === 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4, gap: 2 }}>
                  <CircularProgress color="secondary" />
                  <Typography>Loading pending transfers...</Typography>
                </Box>
              ) : incoming.length === 0 ? (
                <Typography>No pending transfers for this asset.</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>From</TableCell>
                      <TableCell>Amount</TableCell>
                      <TableCell>TXID</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {incoming.map(pmt => (
                      <TableRow key={pmt.messageId}>
                        <TableCell>{pmt.sender || '(unknown)'}</TableCell>
                        <TableCell>
                          {pmt.amount} {resolvedAssetName}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 160 }}>
                          <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                            {pmt.txid || '(no txid)'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                            <Button
                              size="small"
                              disabled={loading}
                              onClick={() => handleAccept(pmt)}
                              startIcon={loading ? <CircularProgress size={12} color="inherit" /> : null}
                            >
                              {loading ? 'Processing...' : 'Accept'}
                            </Button>
                            <Button
                              size="small"
                              disabled={loading}
                              onClick={() => handleRefund(pmt)}
                              color="inherit"
                            >
                              Refund
                            </Button>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Grid>
          </Grid>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default Receive
