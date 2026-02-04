import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Stack,
  Avatar,
  Chip,
  IconButton,
  Tooltip
} from '@mui/material'
import type { PaletteMode } from '@mui/material'
import TokenIcon from '@mui/icons-material/Token'
import AppsIcon from '@mui/icons-material/Apps'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import SendIcon from '@mui/icons-material/Send'
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Img } from '@bsv/uhrp-react'
import { useTheme } from '@mui/material/styles'

interface TokenAccessPromptProps {
  app: string
  message: string
  onAllow: () => void
  onDeny: () => void
  paletteMode?: PaletteMode
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

const normalizeAppLabel = (rawLabel: string): string => {
  let label = rawLabel
  if (label.startsWith('babbage_app_')) {
    label = label.substring(12)
  }
  if (label.startsWith('https://')) {
    label = label.substring(8)
  }
  if (label.startsWith('http://')) {
    label = label.substring(7)
  }
  return label
}

const resolveAppBaseUrl = (label: string): string => {
  return label.startsWith('localhost:') ? `http://${label}` : `https://${label}`
}

const AppOriginChip: React.FC<{ app: string; size?: 'default' | 'compact'; paletteMode?: PaletteMode }> = ({
  app,
  size = 'default',
  paletteMode
}) => {
  const theme = useTheme()
  const resolvedMode = paletteMode ?? theme.palette.mode
  const normalizedLabel = useMemo(() => normalizeAppLabel(app), [app])
  const [displayName, setDisplayName] = useState(normalizedLabel)
  const [iconUrl, setIconUrl] = useState<string | undefined>(undefined)
  const chipHeight = size === 'compact' ? 38 : 44
  const avatarSize = size === 'compact' ? 28 : 32
  const maxLabelWidth = size === 'compact' ? 150 : 180
  const chipBg = resolvedMode === 'dark'
    ? 'rgba(255, 255, 255, 0.08)'
    : 'rgba(0, 0, 0, 0.06)'
  const chipBorder = resolvedMode === 'dark'
    ? '1px solid rgba(255, 255, 255, 0.18)'
    : '1px solid rgba(0, 0, 0, 0.12)'
  const avatarBg = resolvedMode === 'dark'
    ? 'rgba(255, 255, 255, 0.12)'
    : 'rgba(0, 0, 0, 0.08)'
  const titleColor = resolvedMode === 'dark'
    ? 'rgba(255, 255, 255, 0.92)'
    : 'rgba(0, 0, 0, 0.82)'
  const subtitleColor = resolvedMode === 'dark'
    ? 'rgba(255, 255, 255, 0.6)'
    : 'rgba(0, 0, 0, 0.55)'

  useEffect(() => {
    let cancelled = false
    const baseUrl = resolveAppBaseUrl(normalizedLabel)

    setDisplayName(normalizedLabel)
    setIconUrl(`${baseUrl}/favicon.ico`)

    const loadManifest = async () => {
      try {
        const response = await fetch(`${baseUrl}/manifest.json`)
        if (!response.ok) return
        const manifest = await response.json()
        if (cancelled) return

        if (manifest?.name) {
          setDisplayName(manifest.name)
        }
        if (Array.isArray(manifest?.icons) && manifest.icons.length > 0) {
          const iconSrc = manifest.icons[0]?.src
          if (typeof iconSrc === 'string') {
            const resolvedIcon = iconSrc.startsWith('http')
              ? iconSrc
              : `${baseUrl}${iconSrc.startsWith('/') ? '' : '/'}${iconSrc}`
            setIconUrl(resolvedIcon)
          }
        }
      } catch {
        // Ignore manifest lookup errors
      }
    }

    void loadManifest()

    return () => {
      cancelled = true
    }
  }, [normalizedLabel])

  return (
    <Chip
      sx={{
        height: chipHeight,
        px: 1,
        borderRadius: 999,
        bgcolor: chipBg,
        border: chipBorder,
        maxWidth: '100%',
        color: titleColor
      }}
      icon={(
        <Avatar sx={{ width: avatarSize, height: avatarSize, bgcolor: avatarBg }}>
          {iconUrl ? (
            <Img
              src={iconUrl}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <AppsIcon sx={{ fontSize: 18, color: titleColor }} />
          )}
        </Avatar>
      )}
      label={(
        <Stack spacing={0} sx={{ minWidth: 0 }}>
          <Typography
            variant={size === 'compact' ? 'caption' : 'body2'}
            sx={{
              fontWeight: 600,
              maxWidth: maxLabelWidth,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: titleColor
            }}
          >
            {displayName}
          </Typography>
          {displayName !== normalizedLabel && (
            <Typography
              variant="caption"
              sx={{
                maxWidth: maxLabelWidth,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: subtitleColor
              }}
            >
              {normalizedLabel}
            </Typography>
          )}
        </Stack>
      )}
    />
  )
}

/**
 * Modal dialog for prompting user to approve BTMS token operations.
 * Displays comprehensive token information in an elegant, user-friendly format.
 * Supports spend, list actions, and list outputs operations.
 */
const TokenAccessPromptDialog: React.FC<TokenAccessPromptProps> = ({
  app,
  message,
  onAllow,
  onDeny,
  paletteMode
}) => {
  const theme = useTheme()
  const promptInfo = useMemo(() => parseTokenMessage(message), [message])
  const [copied, setCopied] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const resolvedMode = paletteMode ?? theme.palette.mode
  const isDarkMode = resolvedMode === 'dark'
  const dialogBg = isDarkMode ? '#1a1d29' : '#f5f6fb'
  const panelBg = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(17, 24, 39, 0.06)'
  const textPrimary = isDarkMode ? 'rgba(255, 255, 255, 0.92)' : 'rgba(17, 24, 39, 0.92)'
  const textSecondary = isDarkMode ? 'rgba(255, 255, 255, 0.72)' : 'rgba(55, 65, 81, 0.75)'
  const textMuted = isDarkMode ? 'rgba(255, 255, 255, 0.6)' : 'rgba(55, 65, 81, 0.6)'
  const borderSoft = isDarkMode ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)'

  const handleCopyAssetId = useCallback(async () => {
    if (!promptInfo?.assetId || !navigator?.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(promptInfo.assetId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignore clipboard failures (permissions/unsupported)
    }
  }, [promptInfo?.assetId])

  if (!promptInfo) {
    return null
  }

  // Determine title and icon based on prompt type
  const getTitle = () => {
    if (promptInfo.type === 'btms_spend') return 'Token Spend Request'
    if (promptInfo.type === 'btms_burn') return 'Token Burn Request'
    if (promptInfo.type === 'btms_access') return 'Token Access Request'
    return 'Authorization Request'
  }

  const getIcon = () => {
    if (promptInfo.type === 'btms_spend') return <SendIcon sx={{ fontSize: 40, color: 'white' }} />
    if (promptInfo.type === 'btms_burn') return <LocalFireDepartmentIcon sx={{ fontSize: 40, color: 'white' }} />
    return <TokenIcon sx={{ fontSize: 40, color: 'white' }} />
  }

  const getActionText = () => {
    if (promptInfo.type === 'btms_spend') {
      const spendInfo = promptInfo as BTMSSpendInfo
      return (
        <Stack spacing={1.5} alignItems="center">
          <Typography variant="body1" sx={{ color: textPrimary, lineHeight: 1.6 }}>
            Authorize this app to spend
          </Typography>
          <AppOriginChip app={app} paletteMode={resolvedMode} />
          <Typography variant="h6" fontWeight="bold" sx={{ mt: 0.5 }}>
            {formatAmount(spendInfo.sendAmount)} {spendInfo.tokenName} tokens
          </Typography>
        </Stack>
      )
    }

    if (promptInfo.type === 'btms_burn') {
      const burnInfo = promptInfo as BTMSBurnInfo
      const isBurnAll = burnInfo.burnAll || burnInfo.burnAmount === 0
      return (
        <Stack spacing={1.5} alignItems="center">
          <Typography variant="body1" sx={{ color: textPrimary, lineHeight: 1.6 }}>
            Authorize this app to burn tokens
          </Typography>
          <AppOriginChip app={app} paletteMode={resolvedMode} />
          <Typography variant="h6" fontWeight="bold" sx={{ mt: 0.5 }}>
            {isBurnAll
              ? `All ${burnInfo.tokenName} tokens`
              : `${formatAmount(burnInfo.burnAmount)} ${burnInfo.tokenName} tokens`}
          </Typography>
          <Typography variant="body2" sx={{ color: textSecondary }}>
            Burned tokens cannot be recovered.
          </Typography>
        </Stack>
      )
    }

    if (promptInfo.type === 'btms_access') {
      const accessChipBg = resolvedMode === 'dark'
        ? 'rgba(255, 255, 255, 0.06)'
        : 'rgba(0, 0, 0, 0.05)'
      const accessChipBorder = resolvedMode === 'dark'
        ? '1px solid rgba(255, 255, 255, 0.14)'
        : '1px solid rgba(0, 0, 0, 0.12)'
      const accessChipText = resolvedMode === 'dark'
        ? 'rgba(255, 255, 255, 0.9)'
        : 'rgba(0, 0, 0, 0.82)'
      return (
        <Stack spacing={2} alignItems="center">
          <Typography variant="body1" sx={{ color: textPrimary, lineHeight: 1.6 }}>
            Authorize this app to access your BTMS tokens
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <AppOriginChip app={app} size="compact" paletteMode={resolvedMode} />
            <ArrowForwardIcon sx={{ color: textMuted }} />
            <Chip
              icon={<TokenIcon sx={{ color: accessChipText }} />}
              label="BTMS Tokens"
              sx={{
                height: 38,
                px: 0.75,
                borderRadius: 999,
                bgcolor: accessChipBg,
                border: accessChipBorder,
                color: accessChipText,
                fontWeight: 600,
                '& .MuiChip-icon': {
                  color: accessChipText
                }
              }}
            />
          </Stack>
          <Typography variant="body2" sx={{ color: textSecondary }}>
            {promptInfo.assetId
              ? `Token scope: ${truncateHex(promptInfo.assetId, 12, 8)}`
              : 'Token scope: all tokens'}
          </Typography>
        </Stack>
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
          bgcolor: dialogBg,
          color: textPrimary
        }
      }}
    >
      <DialogContent sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h5" fontWeight="bold" sx={{ mb: 3 }}>
          {getTitle()}
        </Typography>

        <Box sx={{
          backgroundColor: panelBg,
          borderRadius: 3,
          p: 4,
          mb: 3
        }}>
          {/* Token Icon */}
          {(() => {
            const iconURL = promptInfo.type !== 'btms_access'
              ? (promptInfo as BTMSSpendInfo | BTMSBurnInfo).iconURL
              : undefined

            return iconURL ? (
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
                  src={iconURL}
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
            )
          })()}

          {/* Authorization Message */}
          {getActionText()}

          {/* Asset ID */}
          {promptInfo.type !== 'btms_access' && promptInfo.assetId && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mt: 1.5 }}>
              <Typography
                variant="caption"
                sx={{
                  color: textMuted,
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
                    color: textMuted,
                    padding: '4px',
                    '&:hover': {
                      color: textPrimary,
                      backgroundColor: isDarkMode
                        ? 'rgba(255, 255, 255, 0.1)'
                        : 'rgba(0, 0, 0, 0.08)'
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
            borderColor: borderSoft,
            color: textPrimary,
            textTransform: 'none',
            fontWeight: 600,
            '&:hover': {
              borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.35)',
              backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
              transform: 'translateY(-1px)'
            }
          }}
        >
          {promptInfo.type === 'btms_burn' ? 'Cancel' : 'Deny'}
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
          {promptInfo.type === 'btms_burn' ? 'Confirm Burn' : 'Approve'}
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
    paletteMode?: PaletteMode
  } | null>(null)

  const promptUser = useCallback(async (app: string, message: string, paletteMode?: PaletteMode): Promise<boolean> => {
    // Request focus before showing the prompt (if handlers provided)
    if (focusHandlers) {
      const currentlyFocused = await focusHandlers.isFocused()
      wasOriginallyFocusedRef.current = currentlyFocused
      if (!currentlyFocused) {
        await focusHandlers.onFocusRequested()
      }
    }

    return new Promise((resolve) => {
      setPromptState({ app, message, resolver: resolve, paletteMode })
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
      <TokenAccessPromptDialog
        app={promptState.app}
        message={promptState.message}
        onAllow={handleAllow}
        onDeny={handleDeny}
        paletteMode={promptState.paletteMode}
      />
    )
  }, [promptState, handleAllow, handleDeny])

  return {
    promptUser,
    PromptComponent
  }
}

export default TokenAccessPromptDialog
