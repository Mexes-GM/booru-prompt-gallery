import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLLMSettings, LLMProvider } from '@/hooks/use-llm-settings'
import { apiUrl } from '@/lib/api-client'
import { Copy, Loader2, Sparkles, Settings2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface ConvertPromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tags: string
}

export function ConvertPromptDialog({ open, onOpenChange, tags }: ConvertPromptDialogProps) {
  const { settings, saveSettings, isLoaded } = useLLMSettings()
  const [result, setResult] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [hasConverted, setHasConverted] = useState(false)
  const [activeTab, setActiveTab] = useState('result')
  const [error, setError] = useState<string | null>(null)

  // Local state for settings form
  const [tempProvider, setTempProvider] = useState<LLMProvider>('cloudflare')
  const [tempApiKey, setTempApiKey] = useState('')

  React.useEffect(() => {
    setHasConverted(false)
  }, [tags])

  // Sync temp settings when dialog opens
  React.useEffect(() => {
    if (open && isLoaded && !isLoading && !hasConverted) {
      setTempProvider(settings.provider)
      setTempApiKey(settings.apiKey)
      setResult('')
      setError(null)
      setActiveTab('result')
      handleConvert(settings.provider, settings.apiKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isLoaded, hasConverted])

  const handleConvert = async (provider: string, apiKey: string) => {
    if (!tags) return

    setIsLoading(true)
    setHasConverted(true)
    setResult('')
    setError(null)

    try {
      const res = await fetch(apiUrl('/api/llm/convert'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tags,
          provider,
          apiKey: provider === 'cloudflare' ? undefined : apiKey,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error('Rate limit exceeded. Please wait a minute or go to Settings and use your own API Key.')
        }
        throw new Error(data.error || 'Failed to convert prompt')
      }

      setResult(data.result)
    } catch (err: any) {
      console.error(err)
      setError(err.message)
      toast({
        title: 'Conversion Failed',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveSettings = () => {
    saveSettings({ provider: tempProvider, apiKey: tempApiKey })
    toast({
      title: 'Settings Saved',
      description: 'Your API preferences have been updated.',
    })
    handleConvert(tempProvider, tempApiKey)
    setActiveTab('result')
  }

  const handleCopy = () => {
    if (!result) return
    navigator.clipboard.writeText(result)
    toast({
      title: 'Copied!',
      description: 'The natural language prompt has been copied to your clipboard.',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-500" />
            AI Prompt Converter
          </DialogTitle>
          <DialogDescription>
            Convert booru tags into a natural language sentence.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="result">Result</TabsTrigger>
            <TabsTrigger value="settings">
              <Settings2 className="w-4 h-4 mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="result" className="space-y-4 mt-4">
            <div className="bg-muted p-4 rounded-md min-h-[120px] relative text-sm text-foreground">
              {isLoading ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <p className="text-red-500 whitespace-pre-wrap">{error}</p>
              ) : hasConverted ? (
                <p className="whitespace-pre-wrap">{result}</p>
              ) : (
                <p className="text-muted-foreground text-center mt-8">Preparing conversion...</p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => handleConvert(settings.provider, settings.apiKey)}
                disabled={isLoading}
              >
                Retry
              </Button>
              <Button onClick={handleCopy} disabled={isLoading || !result || !!error}>
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4 mt-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>AI Provider</Label>
                <Select value={tempProvider} onValueChange={(v) => setTempProvider(v as LLMProvider)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cloudflare">Cloudflare Workers AI (Free)</SelectItem>
                    <SelectItem value="openai">OpenAI (GPT-4o-mini)</SelectItem>
                    <SelectItem value="gemini">Google Gemini (Flash)</SelectItem>
                  </SelectContent>
                </Select>
                {tempProvider === 'cloudflare' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Uses Llama 3 8B. Completely free, no API key required.
                  </p>
                )}
              </div>

              {tempProvider !== 'cloudflare' && (
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    placeholder={`Enter your ${tempProvider} API key`}
                    value={tempApiKey}
                    onChange={(e) => setTempApiKey(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Your key is stored securely in your browser&apos;s localStorage.
                  </p>
                </div>
              )}

              <Button className="w-full" onClick={handleSaveSettings}>
                Save and Regenerate
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
