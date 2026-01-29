import React, { useState, useCallback, useMemo, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Stack,
  Divider,
  Avatar,
  Chip
} from '@mui/material'
import TokenIcon from '@mui/icons-material/Token'
import AppsIcon from '@mui/icons-material/Apps'
import SendIcon from '@mui/icons-material/Send'
import PersonIcon from '@mui/icons-material/Person'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'

interface TokenUsagePromptProps {
  app: string
  message: string
  onAllow: () => void
  onDeny: () => void
}

/**
 * Structured token spend info from BasicTokenModule
 */
interface BTMSSpendInfo {
  type: 'btms_spend'
  sendAmount: number
  tokenName: string
  assetId: string
  recipient?: string
  iconURL?: string
  changeAmount: number
  totalInputAmount: number
}

/**
 * Parses the BTMS token message to extract structured information.
 * Now supports JSON-encoded spend info from BasicTokenModule.
 */
const parseTokenMessage = (message: string): BTMSSpendInfo | null => {
  try {
    const parsed = JSON.parse(message)
    if (parsed.type === 'btms_spend') {
      return parsed as BTMSSpendInfo
    }
  } catch {
    // Not JSON, fall back to legacy parsing
  }

  // Legacy format: "Spend {amount} {tokenName} token(s)\n\nAsset ID: {assetId}\nApp: {app}"
  const lines = message.split('\n')
  const firstLine = lines[0] || ''

  const spendMatch = firstLine.match(/Spend (\d+) (.+?) token/)
  const amount = spendMatch?.[1] ? parseInt(spendMatch[1], 10) : 0
  const tokenName = spendMatch?.[2] || 'Unknown Token'

  const assetIdMatch = message.match(/Asset ID: (.+?)(?:\n|$)/)
  const assetId = assetIdMatch?.[1] || ''

  return {
    type: 'btms_spend',
    sendAmount: amount,
    tokenName,
    assetId,
    changeAmount: 0,
    totalInputAmount: amount
  }
}

/**
 * Formats a number with locale-aware separators
 */
const formatAmount = (amount: number): string => {
  return amount.toLocaleString()
}

/**
 * Truncates a hex string (like identity key or asset ID) for display
 */
const truncateHex = (hex: string, startChars = 8, endChars = 6): string => {
  if (hex.length <= startChars + endChars + 3) return hex
  return `${hex.slice(0, startChars)}...${hex.slice(-endChars)}`
}

/**
 * Modal dialog for prompting user to approve BTMS token spending.
 * Displays comprehensive token information in an elegant, user-friendly format.
 */
const TokenUsagePromptDialog: React.FC<TokenUsagePromptProps> = ({
  app,
  message,
  onAllow,
  onDeny
}) => {
  const spendInfo = useMemo(() => parseTokenMessage(message), [message])

  if (!spendInfo) {
    return null
  }

  const hasRecipient = spendInfo.recipient && spendInfo.recipient.length > 0
  const hasChange = spendInfo.changeAmount > 0
  const hasAssetId = spendInfo.assetId && spendInfo.assetId.length > 0

  return (
    <Dialog
      open={true}
      onClose={onDeny}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          overflow: 'hidden'
        }
      }}
    >
      {/* Header with gradient */}
      <Box sx={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        p: 3,
        color: 'white'
      }}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <Avatar sx={{ bgcolor: 'rgba(255,255,255,0.2)', width: 48, height: 48 }}>
            <TokenIcon sx={{ fontSize: 28 }} />
          </Avatar>
          <Box>
            <Typography variant="h6" fontWeight="bold">
              Token Transfer Request
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              Review and approve this transaction
            </Typography>
          </Box>
        </Box>
      </Box>

      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={3}>
          {/* App requesting */}
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            p: 2,
            backgroundColor: 'grey.50',
            borderRadius: 2
          }}>
            <AppsIcon color="action" />
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Requesting App
              </Typography>
              <Typography variant="body1" fontWeight="medium">
                {app}
              </Typography>
            </Box>
          </Box>

          {/* Main amount display */}
          <Box sx={{
            textAlign: 'center',
            p: 4,
            background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.08) 0%, rgba(118, 75, 162, 0.08) 100%)',
            borderRadius: 3,
            border: '2px solid',
            borderColor: 'primary.light'
          }}>
            {spendInfo.iconURL && (
              <Avatar
                src={spendInfo.iconURL}
                sx={{ width: 64, height: 64, mx: 'auto', mb: 2 }}
              >
                <TokenIcon sx={{ fontSize: 32 }} />
              </Avatar>
            )}
            <Typography variant="h3" fontWeight="bold" color="primary.main" gutterBottom>
              {formatAmount(spendInfo.sendAmount)}
            </Typography>
            <Typography variant="h5" color="text.primary" fontWeight="medium">
              {spendInfo.tokenName}
            </Typography>
            {hasAssetId && (
              <Chip
                label={truncateHex(spendInfo.assetId, 12, 8)}
                size="small"
                variant="outlined"
                sx={{ mt: 1.5, fontFamily: 'monospace', fontSize: '0.75rem' }}
              />
            )}
          </Box>

          {/* Transaction details */}
          <Box sx={{
            backgroundColor: 'grey.50',
            borderRadius: 2,
            overflow: 'hidden'
          }}>
            {/* Recipient */}
            {hasRecipient && (
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 2,
                borderBottom: '1px solid',
                borderColor: 'divider'
              }}>
                <Avatar sx={{ bgcolor: 'success.light', width: 36, height: 36 }}>
                  <PersonIcon sx={{ fontSize: 20, color: 'success.dark' }} />
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Recipient
                  </Typography>
                  <Typography
                    variant="body2"
                    fontFamily="monospace"
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {spendInfo.recipient}...
                  </Typography>
                </Box>
                <SendIcon color="action" sx={{ fontSize: 20 }} />
              </Box>
            )}

            {/* Change info */}
            {hasChange && (
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 2
              }}>
                <Avatar sx={{ bgcolor: 'info.light', width: 36, height: 36 }}>
                  <SwapHorizIcon sx={{ fontSize: 20, color: 'info.dark' }} />
                </Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Change (returned to you)
                  </Typography>
                  <Typography variant="body2" fontWeight="medium">
                    {formatAmount(spendInfo.changeAmount)} {spendInfo.tokenName}
                  </Typography>
                </Box>
              </Box>
            )}

            {/* Total from inputs */}
            {spendInfo.totalInputAmount > spendInfo.sendAmount && (
              <Box sx={{
                p: 2,
                backgroundColor: 'grey.100',
                borderTop: '1px solid',
                borderColor: 'divider'
              }}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">
                    Total from wallet
                  </Typography>
                  <Typography variant="body2" fontWeight="medium">
                    {formatAmount(spendInfo.totalInputAmount)} tokens
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>

          {/* Warning/info box */}
          <Box sx={{
            p: 2,
            backgroundColor: 'warning.lighter',
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'warning.light'
          }}>
            <Typography variant="body2" color="warning.dark">
              <strong>Review carefully:</strong> This action will transfer tokens from your wallet.
              Only approve if you trust this application.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>

      <Divider />

      <DialogActions sx={{ p: 2.5, gap: 1.5 }}>
        <Button
          onClick={onDeny}
          color="inherit"
          variant="outlined"
          size="large"
          fullWidth
          sx={{ borderRadius: 2, py: 1.5 }}
        >
          Deny
        </Button>
        <Button
          onClick={onAllow}
          color="primary"
          variant="contained"
          size="large"
          autoFocus
          fullWidth
          sx={{
            borderRadius: 2,
            py: 1.5,
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            '&:hover': {
              background: 'linear-gradient(135deg, #5a6fd6 0%, #6a4190 100%)'
            }
          }}
        >
          Approve Transfer
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * Focus handlers for window management (optional)
 */
export interface FocusHandlers {
  isFocused: () => Promise<boolean>
  onFocusRequested: () => Promise<void>
  onFocusRelinquished: () => Promise<void>
}

/**
 * Hook for managing BTMS token usage prompts.
 * Returns a function that can be called to prompt the user and a component to render.
 * 
 * @param focusHandlers - Optional focus management handlers for desktop apps
 */
export const useTokenUsagePrompt = (focusHandlers?: FocusHandlers) => {
  const wasOriginallyFocusedRef = useRef(false)

  const [promptState, setPromptState] = useState<{
    app: string
    message: string
    resolver: (value: boolean) => void
  } | null>(null)

  const promptUser = useCallback(async (app: string, message: string): Promise<boolean> => {
    // Request focus before showing the prompt (if handlers provided)
    if (focusHandlers) {
      const currentlyFocused = await focusHandlers.isFocused()
      wasOriginallyFocusedRef.current = currentlyFocused
      if (!currentlyFocused) {
        await focusHandlers.onFocusRequested()
      }
    }

    return new Promise((resolve) => {
      setPromptState({ app, message, resolver: resolve })
    })
  }, [focusHandlers])

  const handleAllow = useCallback(() => {
    if (promptState) {
      promptState.resolver(true)
      setPromptState(null)
      // Relinquish focus if we weren't originally focused
      if (focusHandlers && !wasOriginallyFocusedRef.current) {
        focusHandlers.onFocusRelinquished()
      }
    }
  }, [promptState, focusHandlers])

  const handleDeny = useCallback(() => {
    if (promptState) {
      promptState.resolver(false)
      setPromptState(null)
      // Relinquish focus if we weren't originally focused
      if (focusHandlers && !wasOriginallyFocusedRef.current) {
        focusHandlers.onFocusRelinquished()
      }
    }
  }, [promptState, focusHandlers])

  const PromptComponent = useCallback(() => {
    if (!promptState) return null

    return (
      <TokenUsagePromptDialog
        app={promptState.app}
        message={promptState.message}
        onAllow={handleAllow}
        onDeny={handleDeny}
      />
    )
  }, [promptState, handleAllow, handleDeny])

  return {
    promptUser,
    PromptComponent
  }
}

export default TokenUsagePromptDialog
