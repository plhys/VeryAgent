/**
 * 前端 AgentDescriptor 类型系统
 *
 * 与后端的 `AgentDescriptor` 一一对应，但使用 TypeScript 类型。
 * 目的是消除 per-agent if-else 分支，让设置页根据描述符自动渲染。
 */

import type { AgentType } from "@/lib/types"

// ---------------------------------------------------------------------------
// 配置字段描述
// ---------------------------------------------------------------------------

/** 配置字段的类型 */
export type FieldType =
  "text" | "password" | "select" | "number" | "textarea" | "json"

/** 单个配置字段的描述 */
export interface ConfigField {
  /** 字段键名（对应环境变量或配置键） */
  key: string
  /** 显示标签 */
  label: string
  /** 字段类型 */
  type: FieldType
  /** 占位符 */
  placeholder?: string
  /** 帮助文本 */
  helpText?: string
  /** 是否必填 */
  required?: boolean
  /** 下拉选项（当 type=select 时） */
  options?: { value: string; label: string }[]
  /** 默认值 */
  defaultValue?: string
}

/** 认证模式 */
export interface AuthMode {
  /** 模式标识 */
  id: string
  /** 显示名称 */
  label: string
  /** 该模式下显示的配置字段 */
  fields: ConfigField[]
}

/** 原生配置文件描述 */
export interface ConfigFileDescriptor {
  /** 相对路径，如 ".claude/settings.json" */
  relativePath: string
  /** 文件格式 */
  format: "json" | "toml" | "yaml" | "dotenv"
}

// ---------------------------------------------------------------------------
// AgentDescriptor — 前端 Agent 描述符
// ---------------------------------------------------------------------------

/** 前端 Agent 描述符，与后端的 `AgentDescriptor` 对应 */
export interface AgentDescriptor {
  /** 智能体类型 */
  agentType: AgentType
  /** 显示名称 */
  name: string
  /** 描述 */
  description: string
  /** 是否支持 MCP */
  supportsMcp: boolean
  /** 是否常驻 */
  resident: boolean

  /** 环境变量映射 */
  envMapping: {
    baseUrlKey: string
    apiKeyKey: string
    modelKey: string
  }

  /** 支持的认证模式 */
  authModes: AuthMode[]

  /** 原生配置文件列表 */
  configFiles: ConfigFileDescriptor[]

  /** 运行时依赖 */
  runtimeDeps: string[]

  /** 图标颜色 */
  color: string
}

// ---------------------------------------------------------------------------
// 认证模式预设
// ---------------------------------------------------------------------------

/** 模型提供商绑定模式（通用） */
const modelProviderAuthMode: AuthMode = {
  id: "model_provider",
  label: "共享模型提供商",
  fields: [
    {
      key: "model_provider_id",
      label: "模型提供商",
      type: "select",
      placeholder: "选择已配置的模型提供商",
      helpText: "使用已配置的 API Key 和基础 URL，统一管理",
      required: true,
      options: [], // 运行时动态填充
    },
    {
      key: "model",
      label: "模型",
      type: "select",
      placeholder: "选择模型",
      helpText: "从提供商拉取的可用模型列表",
      options: [], // 运行时动态填充
    },
  ],
}

/** API Key 手动配置模式（通用） */
const apiKeyAuthMode = (
  baseUrlKey: string,
  apiKeyKey: string,
  modelKey: string
): AuthMode => ({
  id: "apikey",
  label: "API Key",
  fields: [
    {
      key: baseUrlKey,
      label: "API 基础 URL",
      type: "text",
      placeholder: "https://api.openai.com/v1",
      helpText: "API 服务地址",
      required: true,
    },
    {
      key: apiKeyKey,
      label: "API Key",
      type: "password",
      placeholder: "sk-...",
      helpText: "你的 API 密钥",
      required: true,
    },
    {
      key: modelKey,
      label: "模型",
      type: "text",
      placeholder: "gpt-4o",
      helpText: "使用的模型名称",
    },
  ],
})

// ---------------------------------------------------------------------------
// Agent 描述符注册表
// ---------------------------------------------------------------------------

/** 所有 Agent 的描述符 */
const AGENT_DESCRIPTORS: Record<string, AgentDescriptor> = {
  claude_code: {
    agentType: "claude_code",
    name: "Claude Code",
    description: "Anthropic 的 AI 编程助手",
    supportsMcp: true,
    resident: false,
    envMapping: {
      baseUrlKey: "ANTHROPIC_BASE_URL",
      apiKeyKey: "ANTHROPIC_AUTH_TOKEN",
      modelKey: "ANTHROPIC_MODEL",
    },
    authModes: [
      modelProviderAuthMode,
      {
        id: "apikey",
        label: "API Key",
        fields: [
          {
            key: "ANTHROPIC_BASE_URL",
            label: "API 基础 URL",
            type: "text",
            placeholder: "https://api.anthropic.com",
            helpText: "Anthropic API 服务地址",
          },
          {
            key: "ANTHROPIC_AUTH_TOKEN",
            label: "API Key",
            type: "password",
            placeholder: "sk-ant-...",
            helpText: "你的 Anthropic API 密钥",
            required: true,
          },
          {
            key: "ANTHROPIC_MODEL",
            label: "模型",
            type: "text",
            placeholder: "claude-sonnet-4-20250514",
            helpText: "使用的 Claude 模型",
          },
        ],
      },
    ],
    configFiles: [{ relativePath: ".claude/settings.json", format: "json" }],
    runtimeDeps: ["node"],
    color: "#d97706",
  },

  codex: {
    agentType: "codex",
    name: "Codex CLI",
    description: "OpenAI 的编程助手",
    supportsMcp: true,
    resident: false,
    envMapping: {
      baseUrlKey: "OPENAI_BASE_URL",
      apiKeyKey: "OPENAI_API_KEY",
      modelKey: "OPENAI_MODEL",
    },
    authModes: [
      modelProviderAuthMode,
      apiKeyAuthMode("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"),
    ],
    configFiles: [{ relativePath: ".codex/config.toml", format: "toml" }],
    runtimeDeps: ["node"],
    color: "#16a34a",
  },

  hermes: {
    agentType: "hermes",
    name: "Hermes Agent",
    description: "常驻管家智能体",
    supportsMcp: true,
    resident: true,
    envMapping: {
      baseUrlKey: "OPENAI_BASE_URL",
      apiKeyKey: "OPENAI_API_KEY",
      modelKey: "OPENAI_MODEL",
    },
    authModes: [
      modelProviderAuthMode,
      apiKeyAuthMode("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"),
    ],
    configFiles: [
      { relativePath: ".hermes/config.yaml", format: "yaml" },
      { relativePath: ".hermes/.env", format: "dotenv" },
    ],
    runtimeDeps: ["uv", "python"],
    color: "#8b5cf6",
  },

  gemini: {
    agentType: "gemini",
    name: "Gemini CLI",
    description: "Google 的 AI 命令行工具",
    supportsMcp: true,
    resident: false,
    envMapping: {
      baseUrlKey: "GOOGLE_GEMINI_BASE_URL",
      apiKeyKey: "GEMINI_API_KEY",
      modelKey: "GEMINI_MODEL",
    },
    authModes: [
      modelProviderAuthMode,
      apiKeyAuthMode(
        "GOOGLE_GEMINI_BASE_URL",
        "GEMINI_API_KEY",
        "GEMINI_MODEL"
      ),
    ],
    configFiles: [{ relativePath: ".gemini/settings.json", format: "json" }],
    runtimeDeps: ["node"],
    color: "#2563eb",
  },

  open_claw: {
    agentType: "open_claw",
    name: "OpenClaw",
    description: "个人 AI 助手",
    supportsMcp: false,
    resident: true,
    envMapping: {
      baseUrlKey: "OPENAI_BASE_URL",
      apiKeyKey: "OPENAI_API_KEY",
      modelKey: "OPENAI_MODEL",
    },
    authModes: [
      modelProviderAuthMode,
      apiKeyAuthMode("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"),
    ],
    configFiles: [{ relativePath: ".openclaw/openclaw.json", format: "json" }],
    runtimeDeps: ["node"],
    color: "#dc2626",
  },

  open_code: {
    agentType: "open_code",
    name: "OpenCode",
    description: "开源编码智能体",
    supportsMcp: true,
    resident: false,
    envMapping: {
      baseUrlKey: "OPENAI_BASE_URL",
      apiKeyKey: "OPENAI_API_KEY",
      modelKey: "OPENAI_MODEL",
    },
    authModes: [
      modelProviderAuthMode,
      apiKeyAuthMode("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"),
    ],
    configFiles: [],
    runtimeDeps: [],
    color: "#0891b2",
  },

  cline: {
    agentType: "cline",
    name: "Cline",
    description: "自主编码智能体",
    supportsMcp: true,
    resident: false,
    envMapping: {
      baseUrlKey: "OPENAI_BASE_URL",
      apiKeyKey: "OPENAI_API_KEY",
      modelKey: "OPENAI_MODEL",
    },
    authModes: [
      modelProviderAuthMode,
      apiKeyAuthMode("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"),
    ],
    configFiles: [],
    runtimeDeps: ["node"],
    color: "#e11d48",
  },

  code_buddy: {
    agentType: "code_buddy",
    name: "CodeBuddy",
    description: "腾讯云 AI 编程助手",
    supportsMcp: true,
    resident: false,
    envMapping: {
      baseUrlKey: "CODEBUDDY_BASE_URL",
      apiKeyKey: "CODEBUDDY_API_KEY",
      modelKey: "CODEBUDDY_MODEL",
    },
    authModes: [
      modelProviderAuthMode,
      apiKeyAuthMode(
        "CODEBUDDY_BASE_URL",
        "CODEBUDDY_API_KEY",
        "CODEBUDDY_MODEL"
      ),
    ],
    configFiles: [],
    runtimeDeps: ["node"],
    color: "#0ea5e9",
  },

  kimi_code: {
    agentType: "kimi_code",
    name: "Kimi Code",
    description: "月之暗面 AI 编程助手",
    supportsMcp: true,
    resident: false,
    envMapping: {
      baseUrlKey: "KIMI_MODEL_BASE_URL",
      apiKeyKey: "KIMI_MODEL_API_KEY",
      modelKey: "KIMI_MODEL_NAME",
    },
    authModes: [
      modelProviderAuthMode,
      apiKeyAuthMode(
        "KIMI_MODEL_BASE_URL",
        "KIMI_MODEL_API_KEY",
        "KIMI_MODEL_NAME"
      ),
    ],
    configFiles: [],
    runtimeDeps: ["node"],
    color: "#f59e0b",
  },

  pi: {
    agentType: "pi",
    name: "Pi",
    description: "可扩展的编码智能体",
    supportsMcp: true,
    resident: false,
    envMapping: {
      baseUrlKey: "OPENAI_BASE_URL",
      apiKeyKey: "OPENAI_API_KEY",
      modelKey: "OPENAI_MODEL",
    },
    authModes: [
      modelProviderAuthMode,
      apiKeyAuthMode("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"),
    ],
    configFiles: [],
    runtimeDeps: ["node"],
    color: "#06b6d4",
  },

  mimo_code: {
    agentType: "mimo_code",
    name: "MiMo Code",
    description: "小米终端 AI 编码智能体",
    supportsMcp: true,
    resident: false,
    envMapping: {
      baseUrlKey: "OPENAI_BASE_URL",
      apiKeyKey: "OPENAI_API_KEY",
      modelKey: "OPENAI_MODEL",
    },
    authModes: [
      modelProviderAuthMode,
      apiKeyAuthMode("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"),
    ],
    configFiles: [],
    runtimeDeps: ["node"],
    color: "#84cc16",
  },

  command_code: {
    agentType: "command_code",
    name: "Command Code",
    description: "内建 ACP 适配器",
    supportsMcp: false,
    resident: false,
    envMapping: {
      baseUrlKey: "OPENAI_BASE_URL",
      apiKeyKey: "OPENAI_API_KEY",
      modelKey: "OPENAI_MODEL",
    },
    authModes: [
      modelProviderAuthMode,
      apiKeyAuthMode("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"),
    ],
    configFiles: [],
    runtimeDeps: ["node"],
    color: "#64748b",
  },
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 获取指定 Agent 的描述符 */
export function getAgentDescriptor(
  agentType: AgentType
): AgentDescriptor | undefined {
  return AGENT_DESCRIPTORS[agentType]
}

/** 获取所有 Agent 描述符 */
export function getAllAgentDescriptors(): AgentDescriptor[] {
  return Object.values(AGENT_DESCRIPTORS)
}

/** 根据环境变量名推断认证模式 */
export function detectAuthMode(
  descriptor: AgentDescriptor,
  env: Record<string, string>,
  modelProviderId: number | null
): string {
  if (modelProviderId != null) return "model_provider"
  if (env[descriptor.envMapping.apiKeyKey]) return "apikey"
  return "apikey" // 默认
}

/** 从环境变量中提取配置值 */
export function extractConfigFromEnv(
  descriptor: AgentDescriptor,
  env: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {}
  const mapping = descriptor.envMapping

  if (env[mapping.apiKeyKey]) result[mapping.apiKeyKey] = env[mapping.apiKeyKey]
  if (env[mapping.baseUrlKey])
    result[mapping.baseUrlKey] = env[mapping.baseUrlKey]
  if (env[mapping.modelKey]) result[mapping.modelKey] = env[mapping.modelKey]

  return result
}
