// @ts-nocheck
"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react"
import { Reorder, useDragControls } from "motion/react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Minus,
  PackagePlus,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Wrench,
} from "lucide-react"
import { isDesktop, openUrl } from "@/lib/platform"
import { getActiveRemoteConnectionId } from "@/lib/transport"
import { toast } from "sonner"
import { AgentIcon } from "@/components/agent-icon"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox"
import { cn, copyTextToClipboard, randomUUID } from "@/lib/utils"
import {
  acpClearBinaryCache,
  acpDetectAgentLocalVersion,
  acpDownloadAgentBinary,
  acpInstallUvTool,
  acpGetAgentStatus,
  acpListAgents,
  acpPreflight,
  acpPrepareNpxAgent,
  acpReorderAgents,
  acpUninstallAgent,
  acpUpdateAgentConfig,
  acpUpdateAgentEnv,
  acpUpdateHermesConfig,
  acpUpdateKimiCodeConfig,
  acpFetchKimiModels,
  acpRevealHermesHome,
  acpOpenHermesSetupTerminal,
  acpDiscoverOpenClawGateway,
  acpEnsureOpenClawGateway,
  codexPollDeviceCode,
  codexRequestDeviceCode,
  fetchModelProviderModels,
  listModelProviders,
  opencodeProviderCatalog,
} from "@/lib/api"
import type {
  AcpAgentInfo,
  AgentType,
  CheckStatus,
  FixAction,
  HermesLocalConfig,
  ModelProviderInfo,
  OpenClawGatewayDiscovery,
  OpenCodeCatalogProvider,
  PreflightResult,
  ProviderModelItem,
} from "@/lib/types"
import { HERMES_PROVIDERS } from "@/lib/types"
import {
  buildAgentReadiness,
  isReadinessPilotAgent,
  readinessToneClass,
  type AgentReadiness,
  type AgentReadinessKind,
} from "@/lib/agent-readiness"
import {
  OpenCodeConnectDialog,
  OpenCodeCustomProviderDialog,
} from "@/components/settings/opencode-connect-dialog"
import {
  buildConnectedModelOptions,
  buildConnectedProviders,
  disconnectProvider,
  formatContextWindow,
  modelReferencesProvider,
  setProviderApiKey,
  setProviderEnabled,
  type OpenCodeModelOptionGroup,
} from "@/lib/opencode-connect"
import { toErrorMessage } from "@/lib/app-error"
import { getInstallErrorHintKey } from "@/lib/agent-install-error"
import { useAgentInstallStream } from "@/hooks/use-agent-install-stream"
import { OpencodePluginsModal } from "./opencode-plugins-modal"
import { CodeBuddyConfigPanel } from "./codebuddy-config-panel"
import { PiConfigPanel } from "./pi-config-panel"
// @ts-nocheck
interface AgentCheckState {
  result?: PreflightResult
  error?: string
}
