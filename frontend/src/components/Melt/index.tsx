// React / UI (btms-ui)
import React, { useState } from 'react'
import { 
  Typography, 
  Button, 
  Dialog, 
  DialogActions, 
  DialogContent, 
  DialogTitle, 
  TextField, 
  CircularProgress, 
  Box,
  Alert
} from '@mui/material'
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment'
import { toast } from 'react-toastify'

import { Asset, btms } from '../../btms/index'

interface MeltProps {
  assetId: string
  asset: Asset
  onReloadNeeded?: () => void
}

const Melt: React.FC<MeltProps> = ({ assetId, asset, onReloadNeeded = () => { } }) => {
  const [quantity, setQuantity] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirmStep, setConfirmStep] = useState(false)

  const qty = Number(quantity)
  const quantityValid = quantity.trim() !== '' && Number.isFinite(qty) && qty > 0 && qty <= asset.balance

  const canMelt = asset.balance > 0 && quantityValid && !loading

  const handleMeltCancel = () => {
    setQuantity('')
    setOpen(false)
    setConfirmStep(false)
  }

  const handleProceedToConfirm = () => {
    if (!quantityValid) {
      toast.error('Invalid amount!')
      return
    }
    setConfirmStep(true)
  }

  const handleMelt = async () => {
    try {
      setLoading(true)

      if (!quantityValid) {
        toast.error('Invalid amount!')
        return
      }

      await btms.melt(assetId, qty)

      try {
        onReloadNeeded()
      } catch { }

      toast.success(`Burned ${qty} ${asset.name} successfully!`)
      setOpen(false)
      setConfirmStep(false)
      setQuantity('')
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
      } else {
        const messageMatch = rawMessage.match(/"message"\s*:\s*"([^"]+)"/)
        if (messageMatch && messageMatch[1]) {
          userMessage = messageMatch[1]
        } else if (rawMessage.length < 100 && !rawMessage.includes('{')) {
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
      <Button 
        onClick={() => setOpen(true)} 
        variant="outlined" 
        color="error" 
        disabled={asset.balance === 0}
        sx={{ minWidth: 100 }}
        startIcon={<LocalFireDepartmentIcon />}
      >
        Burn
      </Button>

      <Dialog open={open} onClose={loading ? undefined : handleMeltCancel} maxWidth="sm" fullWidth>
        <DialogTitle variant="h4" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
          <LocalFireDepartmentIcon color="error" />
          Burn {asset.name}
        </DialogTitle>

        <DialogContent sx={{ minHeight: 200 }}>
          {loading && (
            <Box sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 4,
              gap: 2
            }}>
              <CircularProgress color="error" size={48} />
              <Typography variant="body1">Processing burn...</Typography>
              <Typography variant="body2" color="text.secondary">Removing tokens from circulation</Typography>
            </Box>
          )}

          {!loading && !confirmStep && (
            <>
              <Alert severity="warning" sx={{ mb: 3 }}>
                <Typography variant="body2">
                  <strong>Warning:</strong> Burning tokens permanently removes them from circulation. This action cannot be undone.
                </Typography>
              </Alert>

              <Typography variant="h6" sx={{ mb: 1 }}>
                Amount to Burn:
              </Typography>

              <TextField
                value={quantity}
                variant="outlined"
                color="error"
                fullWidth
                placeholder="Enter amount"
                helperText={asset.balance > 0 ? `Available: ${asset.balance}` : 'No balance available'}
                onChange={e => setQuantity(e.target.value.replace(/\D/g, ''))}
                sx={{ mb: 2 }}
              />

              <Button 
                variant="text" 
                color="error" 
                size="small"
                onClick={() => setQuantity(String(asset.balance))}
              >
                Burn All ({asset.balance})
              </Button>
            </>
          )}

          {!loading && confirmStep && (
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <LocalFireDepartmentIcon sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />
              
              <Typography variant="h5" sx={{ mb: 2 }}>
                Confirm Burn
              </Typography>
              
              <Typography variant="body1" sx={{ mb: 3 }}>
                You are about to permanently burn <strong>{qty} {asset.name}</strong>.
              </Typography>
              
              <Alert severity="error" sx={{ textAlign: 'left' }}>
                <Typography variant="body2">
                  This action is <strong>irreversible</strong>. The tokens will be permanently removed from circulation and cannot be recovered.
                </Typography>
              </Alert>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button disabled={loading} color="inherit" variant="outlined" onClick={handleMeltCancel}>
            Cancel
          </Button>

          {!confirmStep ? (
            <Button
              disabled={!canMelt}
              color="error"
              variant="contained"
              onClick={handleProceedToConfirm}
            >
              Continue
            </Button>
          ) : (
            <Button
              disabled={loading}
              color="error"
              variant="contained"
              onClick={handleMelt}
              startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <LocalFireDepartmentIcon />}
            >
              {loading ? 'Burning...' : 'Confirm Burn'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  )
}

export default Melt
