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
  Chip,
  IconButton,
  Tooltip
} from '@mui/material'
import TokenIcon from '@mui/icons-material/Token'
import AppsIcon from '@mui/icons-material/Apps'
import SendIcon from '@mui/icons-material/Send'
import PersonIcon from '@mui/icons-material/Person'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Img } from '@bsv/uhrp-react'

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
 * Structured token burn info from BasicTokenModule
 */
interface BTMSBurnInfo {
  type: 'btms_burn'
  burnAmount: number
  tokenName: string
  assetId: string
  iconURL?: string
  burnAll?: boolean
}

/**
 * Unified BTMS access request (listActions/listOutputs)
 */
interface BTMSAccessInfo {
  type: 'btms_access'
  action: string
  assetId?: string
}

type BTMSPromptInfo = BTMSSpendInfo | BTMSBurnInfo | BTMSAccessInfo

/**
 * Parses the BTMS token message to extract structured information.
 * Now supports JSON-encoded spend info from BasicTokenModule.
 */
const parseTokenMessage = (message: string): BTMSPromptInfo | null => {
  try {
    const parsed = JSON.parse(message)
    if (parsed.type === 'btms_spend' || parsed.type === 'btms_burn' || parsed.type === 'btms_access') {
      return parsed as BTMSPromptInfo
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
 * Modal dialog for prompting user to approve BTMS token operations.
 * Displays comprehensive token information in an elegant, user-friendly format.
 * Supports spend, list actions, and list outputs operations.
 */
const TokenUsagePromptDialog: React.FC<TokenUsagePromptProps> = ({
  app,
  message,
  onAllow,
  onDeny
}) => {
  const promptInfo = useMemo(() => parseTokenMessage(message), [message])
  const [copied, setCopied] = useState(false)

  const handleCopyAssetId = useCallback(() => {
    if (promptInfo?.assetId) {
      navigator.clipboard.writeText(promptInfo.assetId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [promptInfo?.assetId])

  if (!promptInfo) {
    return null
  }

  const renderTokenSummary = () => {
    if (promptInfo.type === 'btms_spend') return null

    const tokenName = 'tokenName' in promptInfo ? (promptInfo.tokenName || 'Tokens') : 'Tokens'
    const scopeLabel = promptInfo.assetId
      ? `Token ID: ${truncateHex(promptInfo.assetId, 12, 8)}`
      : 'Token scope: all tokens'
    const iconURL = 'iconURL' in promptInfo ? promptInfo.iconURL : undefined

    return (
      <Stack spacing={1.5} alignItems="center" sx={{ mt: 2 }}>
        {iconURL ? (
          <Box sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            overflow: 'hidden',
            bgcolor: 'rgba(255, 255, 255, 0.08)'
          }}>
            <Img
              src={iconURL}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </Box>
        ) : (
          <Avatar
            sx={{
              width: 56,
              height: 56,
              bgcolor: 'rgba(255, 255, 255, 0.08)'
            }}
          >
            <TokenIcon sx={{ fontSize: 28, color: 'white' }} />
          </Avatar>
        )}
        <Typography variant="subtitle1" fontWeight={600}>
          {tokenName}
        </Typography>
        <Chip
          label={scopeLabel}
          sx={{
            bgcolor: 'rgba(255, 255, 255, 0.08)',
            color: 'rgba(255, 255, 255, 0.8)',
            fontFamily: 'monospace',
            maxWidth: '100%'
          }}
        />
      </Stack>
    )
  }

  // Determine title and icon based on prompt type
  const getTitle = () => {
    if (promptInfo.type === 'btms_spend') return 'Spend Authorization Request'
    if (promptInfo.type === 'btms_burn') return 'Burn Authorization Request'
    if (promptInfo.type === 'btms_access') return 'Token Access Request'
    return 'Authorization Request'
  }

  const getIcon = () => {
    if (promptInfo.type === 'btms_spend') return <SendIcon sx={{ fontSize: 40, color: 'white' }} />
    if (promptInfo.type === 'btms_burn') return <SwapHorizIcon sx={{ fontSize: 40, color: 'white' }} />
    return <TokenIcon sx={{ fontSize: 40, color: 'white' }} />
  }

  const getActionText = () => {
    if (promptInfo.type === 'btms_spend') {
      const spendInfo = promptInfo as BTMSSpendInfo
      return (
        <>
          <Typography variant="body1" sx={{ color: 'rgba(255, 255, 255, 0.9)', lineHeight: 1.6 }}>
            Authorize <strong>{app}</strong> to spend
          </Typography>
          <Typography variant="h6" fontWeight="bold" sx={{ mt: 1 }}>
            {formatAmount(spendInfo.sendAmount)} {spendInfo.tokenName} tokens
          </Typography>
        </>
      )
    }

    if (promptInfo.type === 'btms_burn') {
      const burnInfo = promptInfo as BTMSBurnInfo
      const isBurnAll = burnInfo.burnAll || burnInfo.burnAmount === 0
      return (
        <>
          <Typography variant="body1" sx={{ color: 'rgba(255, 255, 255, 0.9)', lineHeight: 1.6 }}>
            Authorize <strong>{app}</strong> to burn tokens
          </Typography>
          <Typography variant="h6" fontWeight="bold" sx={{ mt: 1 }}>
            {isBurnAll
              ? `All ${burnInfo.tokenName} tokens`
              : `${formatAmount(burnInfo.burnAmount)} ${burnInfo.tokenName} tokens`}
          </Typography>
        </>
      )
    }

    if (promptInfo.type === 'btms_access') {
      return (
        <>
          <Typography variant="body1" sx={{ color: 'rgba(255, 255, 255, 0.9)', lineHeight: 1.6 }}>
            Authorize <strong>{app}</strong> to access your BTMS tokens
          </Typography>
          <Typography variant="body2" sx={{ mt: 1.5, color: 'rgba(255, 255, 255, 0.7)' }}>
            {promptInfo.assetId
              ? `Token ID: ${truncateHex(promptInfo.assetId, 12, 8)}`
              : 'Token scope: all tokens'}
          </Typography>
        </>
      )
    }

    return null
  }

  return (
    <Dialog
      open={true}
      onClose={onDeny}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          bgcolor: '#1a1d29',
          color: 'white'
        }
      }}
    >
      <DialogContent sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h5" fontWeight="bold" sx={{ mb: 4 }}>
          {getTitle()}
        </Typography>

        <Box sx={{
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 3,
          p: 4,
          mb: 3
        }}>
          {/* Token Icon */}
          {promptInfo.type === 'btms_spend' && (promptInfo as BTMSSpendInfo).iconURL ? (
            <Box sx={{
              width: 80,
              height: 80,
              mx: 'auto',
              mb: 3,
              borderRadius: '50%',
              overflow: 'hidden',
              bgcolor: 'rgba(255, 255, 255, 0.1)'
            }}>
              <Img
                src={(promptInfo as BTMSSpendInfo).iconURL!}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </Box>
          ) : (
            <Avatar sx={{
              width: 80,
              height: 80,
              mx: 'auto',
              mb: 3,
              bgcolor: 'rgba(255, 255, 255, 0.1)'
            }}>
              {getIcon()}
            </Avatar>
          )}

          {/* Authorization Message */}
          {getActionText()}

          {renderTokenSummary()}

          {/* Asset ID */}
          {promptInfo.assetId && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mt: 1.5 }}>
              <Typography
                variant="caption"
                sx={{
                  color: 'rgba(255, 255, 255, 0.6)',
                  fontFamily: 'monospace',
                  fontSize: '0.75rem'
                }}
              >
                {truncateHex(promptInfo.assetId, 12, 8)}
              </Typography>
              <Tooltip title={copied ? 'Copied!' : 'Copy Asset ID'} arrow>
                <IconButton
                  onClick={handleCopyAssetId}
                  size="small"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.6)',
                    padding: '4px',
                    '&:hover': {
                      color: 'rgba(255, 255, 255, 0.9)',
                      backgroundColor: 'rgba(255, 255, 255, 0.1)'
                    }
                  }}
                >
                  <ContentCopyIcon sx={{ fontSize: '0.875rem' }} />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 3, gap: 2 }}>
        <Button
          onClick={onDeny}
          variant="outlined"
          size="large"
          fullWidth
          sx={{
            borderRadius: 999,
            py: 1,
            borderWidth: 2,
            borderColor: 'rgba(255, 255, 255, 0.3)',
            color: 'rgba(255, 255, 255, 0.9)',
            textTransform: 'none',
            fontWeight: 600,
            '&:hover': {
              borderColor: 'rgba(255, 255, 255, 0.5)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              transform: 'translateY(-1px)'
            }
          }}
        >
          Deny
        </Button>
        <Button
          onClick={onAllow}
          variant="contained"
          size="large"
          autoFocus
          fullWidth
          sx={{
            borderRadius: 999,
            py: 1,
            backgroundImage: 'linear-gradient(120deg, #6756FF, #FF7EB3)',
            color: '#FFFFFF',
            textTransform: 'none',
            fontWeight: 600,
            boxShadow: '0 8px 16px rgba(103,86,255,0.3)',
            '&:hover': {
              backgroundImage: 'linear-gradient(120deg, #5645EE, #EE6DA2)',
              transform: 'translateY(-1px)',
              boxShadow: '0 12px 24px rgba(103,86,255,0.4)'
            }
          }}
        >
          Approve
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
 * Hook for managing BTMS token spend prompts.
 * Returns a function that can be called to prompt the user and a component to render.
 * 
 * @param focusHandlers - Optional focus management handlers for desktop apps
 */
export const useTokenSpendPrompt = (focusHandlers?: FocusHandlers) => {
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
