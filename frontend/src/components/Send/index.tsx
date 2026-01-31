// React / UI (btms-ui)
import React, { useState, useMemo } from 'react'
import { Typography, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, CircularProgress, Box } from '@mui/material'
import { toast } from 'react-toastify'
import useStyles from './send-style'
import { IdentitySearchField } from '@bsv/identity-react'

import { Asset, btms } from '../../btms/index'
import { SatoshiValue } from '@bsv/sdk'

type SendArgs = {
  assetId: string
  recipient: string
  amount: SatoshiValue
}

interface SendProps {
  assetId: string
  asset: Asset
  onReloadNeeded?: () => void
}

const Send: React.FC<SendProps> = ({ assetId, asset, onReloadNeeded = () => { } }) => {
  const classes = useStyles()

  const [recipient, setRecipient] = useState('')
  const [quantity, setQuantity] = useState('')

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  // ----------------------------
  // Dynamic UI validation
  // ----------------------------

  const qty = Number(quantity)

  const quantityValid = quantity.trim() !== '' && Number.isFinite(qty) && qty > 0 && qty <= asset.balance

  const recipientValid = recipient.trim() !== '' && recipient.length >= 64

  // Disable send button when:
  //  1. balance is 0
  //  2. invalid quantity
  //  3. invalid recipient
  const canSend = asset.balance > 0 && quantityValid && recipientValid && !loading

  const handleSendCancel = () => {
    setRecipient('')
    setQuantity('')
    setOpen(false)
  }

  const handleSend = async () => {
    try {
      setLoading(true)

      // -----------------------------
      // RE-VALIDATE ON SUBMIT
      // (no bypass possible)
      // -----------------------------
      if (!recipientValid) {
        toast.error('Invalid recipient identity key!')
        return
      }

      if (!quantityValid) {
        toast.error('Invalid amount!')
        return
      }

      await btms.send(assetId, recipient, qty)

      try {
        onReloadNeeded()
      } catch { }

      toast.success(`Transferred ${qty} ${asset.name} successfully!`)
      setOpen(false)
    } catch (err: any) {
      console.error(err)
      const rawMessage = err?.message || ''

      // Parse user-friendly error messages
      let userMessage = 'Something went wrong!'

      if (rawMessage.includes('User denied')) {
        userMessage = 'Transaction cancelled by user'
      } else if (rawMessage.includes('Permission denied') || rawMessage.includes('permission')) {
        userMessage = 'Permission request cancelled'
      } else if (rawMessage.includes('Insufficient') || rawMessage.includes('insufficient')) {
        userMessage = 'Insufficient balance for this transaction'
      } else if (rawMessage.includes('network') || rawMessage.includes('Network')) {
        userMessage = 'Network error. Please check your connection and try again.'
      } else if (rawMessage.includes('timeout') || rawMessage.includes('Timeout')) {
        userMessage = 'Request timed out. Please try again.'
      } else if (rawMessage.includes('invalid') || rawMessage.includes('Invalid')) {
        userMessage = 'Invalid transaction details. Please check and try again.'
      } else {
        // Try to extract just the message part if it's a JSON-like error
        const messageMatch = rawMessage.match(/"message"\s*:\s*"([^"]+)"/)
        if (messageMatch && messageMatch[1]) {
          userMessage = messageMatch[1]
        } else if (rawMessage.length < 100 && !rawMessage.includes('{')) {
          // Use the raw message if it's short and not JSON
          userMessage = rawMessage
        }
      }

      toast.error(userMessage, { autoClose: 5000 })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Disable main send button if balance = 0 */}
      <Button
        onClick={() => setOpen(true)}
        variant="contained"
        color="secondary"
        disabled={asset.balance === 0}
        sx={{ minWidth: 100, color: 'white' }}
      >
        Send
      </Button>

      <Dialog open={open} onClose={loading ? undefined : handleSendCancel} color="primary" maxWidth="md" fullWidth>
        <DialogTitle variant="h4" sx={{ fontWeight: 'bold' }}>
          Send {asset.name}
        </DialogTitle>

        <DialogContent sx={{ minHeight: 400 }}>
          {loading && (
            <Box sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 4,
              gap: 2
            }}>
              <CircularProgress color="secondary" size={48} />
              <Typography variant="body1">Processing send...</Typography>
              <Typography variant="body2" color="text.secondary">Recording on blockchain</Typography>
            </Box>
          )}

          {!loading && (
            <>
              <Typography variant="h6" sx={{ mb: 1 }}>Recipient:</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Search by name or paste identity key
              </Typography>

              <Box sx={{ mb: 4, position: 'relative', zIndex: 1000, width: '100%' }}>
                <IdentitySearchField
                  onIdentitySelected={(identity) => {
                    if (identity?.identityKey) {
                      setRecipient(identity.identityKey)
                    }
                  }}
                  width="300px"
                  appName="BTMS"
                />
              </Box>

              {recipient && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2, wordBreak: 'break-all' }}>
                  Selected: {recipient}
                </Typography>
              )}

              <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>
                Quantity:
              </Typography>

              <TextField
                className={classes.form}
                value={quantity}
                variant="outlined"
                color="secondary"
                fullWidth
                helperText={asset.balance > 0 ? `Available: ${asset.balance}` : 'No balance available'}
                onChange={e => setQuantity(e.target.value.replace(/\D/g, ''))}
              />
            </>
          )}
        </DialogContent>

        <DialogActions className={classes.button}>
          <Button disabled={loading} color="secondary" variant="outlined" onClick={handleSendCancel}>
            Cancel
          </Button>

          <Button
            disabled={!canSend}
            color="secondary"
            variant="outlined"
            onClick={handleSend}
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {loading ? 'Sending...' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default Send
