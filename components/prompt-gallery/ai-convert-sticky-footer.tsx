import { useEffect, useState, memo, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { X, Copy, Check, Sparkles, Settings2, Loader2, RefreshCw, AlertCircle, History, Trash2 } from "lucide-react"
import { useLLMSettings, LLMProvider } from '@/hooks/use-llm-settings'
import { apiUrl } from '@/lib/api-client'
import { Turnstile, isTurnstileEnabled } from "@/components/turnstile"
import { toast } from '@/hooks/use-toast'
import { motion, AnimatePresence } from 'framer-motion'
import { useLowMotion } from '@/hooks/use-low-motion'
import { cn } from '@/lib/utils'
import OpenAIMono from '@lobehub/icons/es/OpenAI/components/Mono'
import AnthropicMono from '@lobehub/icons/es/Anthropic/components/Mono'
import GoogleMono from '@lobehub/icons/es/Google/components/Mono'
import DeepSeekMono from '@lobehub/icons/es/DeepSeek/components/Mono'
import OpenRouterMono from '@lobehub/icons/es/OpenRouter/components/Mono'
import CloudflareMono from '@lobehub/icons/es/Cloudflare/components/Mono'

// ── Provider icons ──────────────────────────────────────────────────────────
const ProviderIcon = ({ provider }: { provider: string }) => {
  const size = 14
  switch (provider) {
    case 'cloudflare':
      return <CloudflareMono size={size} />
    case 'openai':
      return <OpenAIMono size={size} />
    case 'gemini':
      return <GoogleMono size={size} />
    case 'claude':
      return <AnthropicMono size={size} />
    case 'deepseek':
      return <DeepSeekMono size={size} />
    case 'openrouter':
      return <OpenRouterMono size={size} />
    default:
      return <CloudflareMono size={size} />
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Provider model catalogs ─────────────────────────────────────────────────
const PROVIDER_MODELS: Record<string, { id: string; label: string; tag?: string }[]> = {
  openai: [
    { id: 'gpt-5.4-mini',  label: 'GPT-5.4 Mini',  tag: 'recommended' },
    { id: 'gpt-5.4',       label: 'GPT-5.4' },
    { id: 'gpt-5.5',       label: 'GPT-5.5' },
    { id: 'gpt-5.5-pro',   label: 'GPT-5.5 Pro',   tag: 'best' },
    { id: 'gpt-5.4-nano',  label: 'GPT-5.4 Nano',  tag: 'fastest' },
  ],
  gemini: [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', tag: 'recommended' },
    { id: 'gemini-3.1-pro',   label: 'Gemini 3.1 Pro',   tag: 'best' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
  ],
  claude: [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tag: 'recommended' },
    { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  tag: 'fastest' },
    { id: 'claude-opus-4-8',   label: 'Claude Opus 4.8',   tag: 'best' },
  ],
  deepseek: [
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', tag: 'recommended' },
    { id: 'deepseek-v4-pro',   label: 'DeepSeek V4 Pro',   tag: 'best' },
  ],
  openrouter: [
    { id: 'google/gemini-3.5-flash',                  label: 'Gemini 3.5 Flash',    tag: 'recommended' },
    { id: 'google/gemma-4-31b-it:free',               label: 'Gemma 4 31B',         tag: 'free' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free',   label: 'Llama 3.3 70B',       tag: 'free' },
    { id: 'openai/gpt-oss-120b:free',                 label: 'GPT OSS 120B',        tag: 'free' },
    { id: 'openai/gpt-oss-20b:free',                  label: 'GPT OSS 20B',         tag: 'free' },
    { id: 'qwen/qwen3-coder:free',                    label: 'Qwen3 Coder 480B',    tag: 'free' },
    { id: 'nvidia/nemotron-3-ultra-550b-a55b:free',   label: 'Nemotron 3 Ultra',    tag: 'free' },
    { id: 'google/gemini-2.5-pro',                    label: 'Gemini 2.5 Pro' },
    { id: 'anthropic/claude-sonnet-4-6',              label: 'Claude Sonnet 4.6' },
    { id: 'openai/gpt-5.4-mini',                      label: 'GPT-5.4 Mini' },
  ],
}
// ─────────────────────────────────────────────────────────────────────────────

export interface ConvertMeta {
  characters?: string
  series?: string
  artist?: string
}

interface AiConvertStickyFooterProps {
  isOpen: boolean
  tags: string
  image?: string
  meta?: ConvertMeta
  onExit: () => void
}

const AiConvertStickyFooterComponent = ({
  isOpen,
  tags,
  image,
  meta,
  onExit
}: AiConvertStickyFooterProps) => {
  const { settings, saveSettings, isLoaded } = useLLMSettings()
  const shouldReduceMotion = useLowMotion()

  const [result, setResult] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [hasConverted, setHasConverted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  const [isPulseActive, setIsPulseActive] = useState(false)
  const [dailyRemaining, setDailyRemaining] = useState<number | null>(null)
  // F2 (rate-limit-antiabuse): Turnstile token for the free AI tier. Stays null
  // (and the widget renders nothing) until NEXT_PUBLIC_TURNSTILE_SITE_KEY is set,
  // so this is a no-op today. Sent only for the free 'cloudflare' provider.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)

  // Controlled popover state so it closes on Save
  const [settingsOpen, setSettingsOpen] = useState(false)

  interface HistoryItem {
    id: string
    tags: string
    result: string
    timestamp: number
  }

  const [history, setHistory] = useState<HistoryItem[]>([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem('ai-convert-history')
      if (stored) {
        setHistory(JSON.parse(stored))
      }
    } catch (e) {
      console.error(e)
    }
  }, [])

  const addToHistory = (tagsToSave: string, resultToSave: string) => {
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      tags: tagsToSave,
      result: resultToSave,
      timestamp: Date.now()
    }
    setHistory(prev => {
      const newHistory = [newItem, ...prev].slice(0, 50)
      localStorage.setItem('ai-convert-history', JSON.stringify(newHistory))
      return newHistory
    })
  }

  const clearHistory = () => {
    setHistory([])
    localStorage.removeItem('ai-convert-history')
  }

  const copyHistoryItem = (text: string) => {
    navigator.clipboard.writeText(text)
    toast({
      title: 'Copied!',
      description: 'The natural language prompt has been copied to your clipboard.',
    })
  }

  // Local state for settings form
  const [tempProvider, setTempProvider] = useState<LLMProvider>('cloudflare')
  const [tempApiKey, setTempApiKey] = useState('')
  const [tempCustomModel, setTempCustomModel] = useState('')
  const [tempRemember, setTempRemember] = useState(false)
  // 'custom' means user wants to type a free-form model ID
  const [tempModelSelection, setTempModelSelection] = useState<string>('')

  // Sync settings popover form state
  useEffect(() => {
    if (isLoaded) {
      setTempProvider(settings.provider)
      setTempApiKey(settings.apiKey)
      setTempRemember(settings.remember ?? false)
      const savedModel = settings.customModel || ''
      setTempCustomModel(savedModel)
      // Determine if saved model is in the catalog or is a custom entry
      const catalog = PROVIDER_MODELS[settings.provider] ?? []
      const inCatalog = catalog.some(m => m.id === savedModel)
      setTempModelSelection(inCatalog ? savedModel : savedModel ? 'custom' : '')
    }
  }, [isOpen, isLoaded, settings])

  const lastConvertedTagsRef = useRef<string>('')

  const handleConvert = async (tagsToConvert: string, prov = settings.provider, key = settings.apiKey, model = settings.customModel) => {
    if (!tagsToConvert) return
    lastConvertedTagsRef.current = tagsToConvert

    setIsLoading(true)
    setHasConverted(true)
    setResult('')
    setError(null)
    setIsCopied(false)

    try {
      const res = await fetch(apiUrl('/api/llm/convert'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tags: tagsToConvert,
          provider: prov,
          apiKey: prov === 'cloudflare' ? undefined : key,
          model: model || undefined,
          image: image || undefined,
          // Authoritative identity metadata (character/series) from the booru API,
          // so the model uses exact names instead of guessing from the tag soup.
          meta: meta && (meta.characters || meta.series || meta.artist) ? meta : undefined,
          // Only the free 'cloudflare' tier is gated server-side (F2).
          turnstile_token: prov === 'cloudflare' ? (turnstileToken || undefined) : undefined,
        }),
      })

      // Read remaining daily quota from headers on every response (success or 429)
      const remaining = res.headers.get('X-RateLimit-Daily-Remaining')
      if (remaining !== null) setDailyRemaining(parseInt(remaining, 10))

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 429) {
          const limitType = res.headers.get('X-RateLimit-Type')
          if (limitType === 'daily') {
            setDailyRemaining(0)
            throw new Error(data.error || 'Daily limit reached. Come back tomorrow or add your own API key in ⚙️ Settings.')
          }
          throw new Error(data.error || 'Too many requests. Please wait a moment before trying again.')
        }
        if (res.status === 503) {
          throw new Error(data.error || 'Cloudflare AI quota exhausted for today. Add your own API key in ⚙️ Settings to continue.')
        }
        throw new Error(data.error || 'Failed to convert prompt')
      }

      setResult(data.result)
      addToHistory(tagsToConvert, data.result)
    } catch (err: any) {
      console.error(err)
      // Show inline only — no duplicate toast
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  // Trigger conversion and pulse when a new tags payload is received
  useEffect(() => {
    if (tags && isOpen && tags !== lastConvertedTagsRef.current) {
      setIsPulseActive(true)
      const timer = setTimeout(() => setIsPulseActive(false), 600)

      handleConvert(tags)

      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags, isOpen])

  const handleSaveSettings = () => {
    saveSettings({ provider: tempProvider, apiKey: tempApiKey, customModel: tempCustomModel, remember: tempRemember })
    toast({
      title: 'Settings Saved',
      description: tempRemember
        ? 'Your API key will be remembered until you clear it.'
        : 'Your API key will be cleared when you close this tab.',
    })
    setSettingsOpen(false)
  }

  const handleCopy = () => {
    if (!result) return
    navigator.clipboard.writeText(result)
    setIsCopied(true)
    toast({
      title: 'Copied!',
      description: 'The natural language prompt has been copied to your clipboard.',
    })
    setTimeout(() => setIsCopied(false), 2000)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="ai-convert-footer"
          initial={shouldReduceMotion ? { opacity: 0 } : { y: 200, opacity: 0, scale: 0.95 }}
          animate={shouldReduceMotion ? { opacity: 1 } : { y: 0, opacity: 1, scale: 1 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { y: 200, opacity: 0, scale: 0.95 }}
          transition={shouldReduceMotion ? { duration: 0.15 } : {
            type: "spring",
            stiffness: 200,
            damping: 25,
            mass: 0.8
          }}
          className={`fixed bottom-6 left-0 right-0 mx-auto z-50 w-[95%] max-w-3xl border shadow-2xl rounded-2xl overflow-hidden ring-1 ring-white/10 ${shouldReduceMotion ? "bg-background/95" : "bg-background/85 backdrop-blur-xl"}`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {/* Border Glow Effect */}
          {!shouldReduceMotion && (
            <div className="absolute inset-0 z-[-1] overflow-hidden rounded-2xl pointer-events-none">
              <motion.div
                animate={{
                  background: [
                    "radial-gradient(circle at 50% 0%, rgba(139,92,246,0.12) 0%, transparent 60%)",
                    "radial-gradient(circle at 50% 0%, rgba(139,92,246,0.18) 0%, transparent 80%)",
                    "radial-gradient(circle at 50% 0%, rgba(139,92,246,0.12) 0%, transparent 60%)"
                  ]
                }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0"
              />
            </div>
          )}

          <div className="p-3 sm:p-4 flex flex-col gap-3">
            {/* F2: Turnstile for the free AI tier. Renders nothing until
                NEXT_PUBLIC_TURNSTILE_SITE_KEY is set; kept in the DOM (sr-only)
                so a token is produced non-interactively for the free provider. */}
            {isTurnstileEnabled() && settings.provider === 'cloudflare' && (
              <Turnstile onVerify={setTurnstileToken} className="sr-only" />
            )}
            {/* Header controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-primary/10 rounded-lg text-primary border border-primary/20">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                </div>
                <span className="font-bold text-sm sm:text-base">
                  AI Prompt Converter
                </span>

                {/* Daily quota indicator — always visible for free Cloudflare tier */}
                {settings.provider === 'cloudflare' ? (
                  <span
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full font-semibold tabular-nums transition-colors',
                      dailyRemaining === null
                        ? 'bg-muted/60 text-muted-foreground border border-border/40'
                        : dailyRemaining === 0
                        ? 'bg-destructive/15 text-destructive border border-destructive/30'
                        : dailyRemaining <= 3
                        ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                    )}
                    title={
                      dailyRemaining !== null
                        ? `${dailyRemaining} free conversions remaining today`
                        : 'Free tier · 10 conversions per day'
                    }
                  >
                    {dailyRemaining !== null ? `${dailyRemaining}/10 left` : 'Free · 10/day'}
                  </span>
                ) : (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-primary/10 text-primary border border-primary/25 transition-colors"
                    title={`Using your own ${settings.provider} API key · no daily limit`}
                  >
                    🔑 {{
                      openai: 'OpenAI',
                      gemini: 'Gemini',
                      claude: 'Claude',
                      deepseek: 'DeepSeek',
                      openrouter: 'OpenRouter',
                    }[settings.provider] ?? settings.provider} · Unlimited
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5 rounded-lg hover:bg-secondary border-border/60 transition-colors text-xs font-semibold"
                      aria-label="View History"
                      title="View History"
                    >
                      <History className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                      History
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="w-full sm:max-w-md flex flex-col h-full border-border/50 shadow-2xl p-0">
                    <SheetHeader className="p-4 sm:p-6 pb-0 border-b border-border/40 bg-gradient-to-r from-primary/5 to-transparent">
                      <div className="flex items-center justify-between">
                        <div>
                          <SheetTitle className="flex items-center gap-2 text-primary">
                            <History className="w-5 h-5" />
                            Conversion History
                          </SheetTitle>
                          <SheetDescription className="mt-1">
                            Your most recent AI natural language conversions.
                          </SheetDescription>
                        </div>
                        {history.length > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={clearHistory}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            title="Clear history"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </SheetHeader>
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                      {history.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground/60 gap-3">
                          <History className="w-10 h-10 opacity-20" />
                          <p className="text-sm">No history yet.</p>
                        </div>
                      ) : (
                        history.map((item) => (
                          <div key={item.id} className="relative rounded-xl border border-border/60 bg-secondary/15 p-4 flex flex-col gap-3 group transition-colors hover:border-primary/30 hover:bg-secondary/30">
                            <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider truncate flex justify-between items-center">
                              <span>Original Tags</span>
                              <span>{new Date(item.timestamp).toLocaleString()}</span>
                            </div>
                            <p className="text-xs text-muted-foreground/80 line-clamp-2" title={item.tags}>
                              {item.tags}
                            </p>
                            <div className="h-px bg-border/40 w-full" />
                            <p className="text-sm text-foreground whitespace-pre-wrap">
                              {item.result}
                            </p>
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2 text-xs"
                                onClick={() => copyHistoryItem(item.result)}
                              >
                                <Copy className="w-3 h-3 mr-1" />
                                Copy
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </SheetContent>
                </Sheet>

                {/* AI settings Popover — controlled to close on save */}
                <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5 rounded-lg hover:bg-secondary border-border/60 transition-colors text-xs font-semibold"
                      aria-label="AI Provider Settings"
                      title="AI Provider Settings"
                    >
                      <Settings2 className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                      Settings
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0 overflow-hidden border-border/50 shadow-2xl" align="end" sideOffset={8}>
                    <div className="bg-gradient-to-r from-primary/10 to-transparent p-3 border-b border-border/40 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" aria-hidden="true" />
                      <span className="text-sm font-semibold text-primary">AI Provider Settings</span>
                    </div>

                    <div className="p-4 space-y-4">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">AI Provider</Label>
                        <Select value={tempProvider} onValueChange={(v) => { setTempProvider(v as LLMProvider); setTempModelSelection(''); setTempCustomModel('') }}>
                          <SelectTrigger className="h-9 rounded-lg bg-background text-xs">
                            <SelectValue placeholder="Select a provider" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cloudflare"><span className="flex items-center gap-2"><ProviderIcon provider="cloudflare" /> Cloudflare Free</span></SelectItem>
                            <SelectItem value="openai"><span className="flex items-center gap-2"><ProviderIcon provider="openai" /> OpenAI</span></SelectItem>
                            <SelectItem value="gemini"><span className="flex items-center gap-2"><ProviderIcon provider="gemini" /> Google Gemini</span></SelectItem>
                            <SelectItem value="claude"><span className="flex items-center gap-2"><ProviderIcon provider="claude" /> Anthropic Claude</span></SelectItem>
                            <SelectItem value="deepseek"><span className="flex items-center gap-2"><ProviderIcon provider="deepseek" /> DeepSeek</span></SelectItem>
                            <SelectItem value="openrouter"><span className="flex items-center gap-2"><ProviderIcon provider="openrouter" /> OpenRouter</span></SelectItem>
                          </SelectContent>
                        </Select>
                        {tempProvider === 'cloudflare' && (
                          <p className="text-[10px] text-muted-foreground mt-1 bg-secondary/40 p-2 rounded border border-border/30">
                            ✨ Free tier · Llama 3.3 70B. No API key needed.
                          </p>
                        )}
                      </div>

                      {tempProvider !== 'cloudflare' && (
                        <div className="space-y-4 pt-3 border-t border-border/30">
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">API Key</Label>
                            <Input
                              type="password"
                              name="llm-api-key"
                              autoComplete="off"
                              placeholder={`Enter your ${tempProvider} API key…`}
                              value={tempApiKey}
                              onChange={(e) => setTempApiKey(e.target.value)}
                              className="h-9 rounded-lg bg-background text-xs"
                            />
                            <p className="text-[10px] text-amber-500/80 flex items-center gap-1 mt-0.5">
                              <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
                              {tempRemember
                                ? 'Stored in browser. Clear anytime by unchecking below.'
                                : 'Session only — cleared when you close this tab.'}
                            </p>
                            <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                              <Checkbox
                                checked={tempRemember}
                                onCheckedChange={(checked) => setTempRemember(checked === true)}
                                className="h-3.5 w-3.5"
                              />
                              <span className="text-[10px] text-muted-foreground font-medium">
                                Remember API key across sessions
                              </span>
                            </label>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Model</Label>
                            {(PROVIDER_MODELS[tempProvider]?.length ?? 0) > 0 ? (
                              <>
                                <Select
                                  value={tempModelSelection}
                                  onValueChange={(v) => {
                                    setTempModelSelection(v)
                                    if (v !== 'custom') setTempCustomModel(v)
                                    else setTempCustomModel('')
                                  }}
                                >
                                  <SelectTrigger className="h-9 rounded-lg bg-background text-xs">
                                    <SelectValue placeholder="Select a model…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PROVIDER_MODELS[tempProvider].map((m) => (
                                      <SelectItem key={m.id} value={m.id} className="text-xs">
                                        <span className="flex items-center gap-1.5">
                                          {m.label}
                                          {m.tag && (
                                            <span className={cn(
                                              'text-[9px] px-1.5 py-0 rounded-full font-bold uppercase tracking-wide',
                                              m.tag === 'recommended' && 'bg-primary/15 text-primary',
                                              m.tag === 'best'        && 'bg-amber-500/15 text-amber-500',
                                              m.tag === 'fastest'     && 'bg-emerald-500/15 text-emerald-500',
                                              m.tag === 'free'        && 'bg-sky-500/15 text-sky-500',
                                            )}>
                                              {m.tag}
                                            </span>
                                          )}
                                        </span>
                                      </SelectItem>
                                    ))}
                                    <SelectItem value="custom" className="text-xs text-muted-foreground">
                                      ✏️ Custom model ID…
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                {tempModelSelection === 'custom' && (
                                  <Input
                                    type="text"
                                    name="llm-custom-model"
                                    autoComplete="off"
                                    placeholder="e.g. gpt-5.5, claude-sonnet-4-6…"
                                    value={tempCustomModel}
                                    onChange={(e) => setTempCustomModel(e.target.value)}
                                    className="h-9 rounded-lg bg-background text-xs mt-1.5"
                                  />
                                )}
                              </>
                            ) : (
                              <Input
                                type="text"
                                name="llm-custom-model"
                                autoComplete="off"
                                placeholder="Custom model ID…"
                                value={tempCustomModel}
                                onChange={(e) => setTempCustomModel(e.target.value)}
                                className="h-9 rounded-lg bg-background text-xs"
                              />
                            )}
                          </div>
                        </div>
                      )}

                      <Button
                        className="w-full h-9 rounded-lg bg-primary text-xs font-semibold"
                        onClick={handleSaveSettings}
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                            Saving…
                          </>
                        ) : 'Save Configuration'}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onExit}
                  aria-label="Close AI Prompt Converter"
                  className="h-8 w-8 rounded-full hover:bg-muted"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            {/* Prompt Output Display */}
            <motion.div
              animate={isPulseActive && !shouldReduceMotion ? {
                scale: [1, 1.015, 1],
                borderColor: ['rgba(139, 92, 246, 0.2)', 'rgba(139, 92, 246, 0.6)', 'rgba(139, 92, 246, 0.2)']
              } : {}}
              transition={{ duration: 0.5 }}
              className="relative rounded-xl border border-border/60 bg-secondary/15 min-h-[90px] max-h-[160px] flex flex-col overflow-hidden transition-colors duration-300"
            >
              {/* Scrollable text area */}
              <div
                className="flex-1 overflow-y-auto p-4 pb-2"
                aria-live="polite"
                aria-atomic="true"
              >
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-4">
                    <div className="relative flex items-center justify-center">
                      <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-primary to-accent opacity-50 blur animate-pulse" />
                      <div className="relative bg-background rounded-full p-2">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground animate-pulse font-medium">Translating tags into natural language…</span>
                  </div>
                ) : error ? (
                  <div className="text-destructive font-medium p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-xs whitespace-pre-wrap" role="alert">
                    {error}
                  </div>
                ) : hasConverted ? (
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-sm select-text font-sans">
                    {result}
                  </p>
                ) : (
                  <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground/60 select-none">
                    <Sparkles
                      className={cn("h-6 w-6 text-primary/30 mb-1.5", !shouldReduceMotion && "animate-pulse")}
                      aria-hidden="true"
                    />
                    <p className="text-xs italic">Waiting for input… click Convert on any card to get started</p>
                  </div>
                )}
              </div>

              {/* Action buttons row — pinned at bottom, never overlapping text */}
              {(hasConverted || error) && !isLoading && (
                <div className="flex justify-end gap-2 px-3 pb-3 pt-1 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 rounded-lg hover:bg-secondary border-border/60 transition-colors text-xs font-semibold"
                    onClick={() => handleConvert(tags)}
                    aria-label="Regenerate conversion"
                    title="Regenerate conversion"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                    Regenerate
                  </Button>
                  {!error && (
                    <Button
                      size="sm"
                      onClick={handleCopy}
                      disabled={!result}
                      className={cn(
                        "h-8 px-3 rounded-lg text-xs font-bold transition-colors shadow-sm",
                        isCopied
                          ? "bg-green-600 hover:bg-green-600 text-white"
                          : "bg-primary hover:bg-primary/90 text-primary-foreground"
                      )}
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5 mr-1 stroke-[2.5px]" aria-hidden="true" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                          Copy
                        </>
                      )}
                    </Button>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export const AiConvertStickyFooter = memo(AiConvertStickyFooterComponent)
