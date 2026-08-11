/**
 * 通用 Agent 设置表单
 *
 * 根据 `AgentDescriptor` 自动渲染配置表单，无需 per-agent if-else。
 * 支持两种认证模式：
 * 1. 模型提供商绑定（共享 API Key）
 * 2. 手动配置 API Key
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { AcpAgentInfo } from "@/lib/types";
import {
  getAgentDescriptor,
  detectAuthMode,
  type AgentDescriptor,
  type AuthMode,
  type ConfigField,
} from "./agent-descriptor";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AgentSettingsFormProps {
  /** 智能体信息（从后端获取） */
  agent: AcpAgentInfo;
  /** 可用模型提供商列表 */
  modelProviders?: { id: number; name: string }[];
  /** 模型提供商变更回调 */
  onModelProviderChange?: (providerId: number | null) => void;
  /** 保存回调 */
  onSave?: (values: Record<string, string>, authMode: string) => void;
  /** 是否正在保存 */
  saving?: boolean;
  /** 获取模型列表回调（仅模型提供商模式） */
  onFetchModels?: () => void;
  /** 是否正在获取模型 */
  fetchingModels?: boolean;
  /** 可用模型列表 */
  availableModels?: { id: string; name: string }[];
  /** 目标模型映射选项（例如 Claude Code 可选的模型列表） */
  targetModelOptions?: { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// 通用配置字段渲染器
// ---------------------------------------------------------------------------

function ConfigFieldInput({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    onChange(field.key, e.target.value);
  };

  const baseClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
        {field.label}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </label>
      {field.type === "select" ? (
        <select
          className={baseClass}
          value={value}
          onChange={handleChange}
        >
          <option value="">{field.placeholder || "请选择..."}</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : field.type === "password" ? (
        <input
          type="password"
          className={baseClass}
          placeholder={field.placeholder}
          value={value}
          onChange={handleChange}
        />
      ) : field.type === "textarea" || field.type === "json" ? (
        <textarea
          className={`${baseClass} min-h-[100px] font-mono text-xs`}
          placeholder={field.placeholder}
          value={value}
          onChange={handleChange}
        />
      ) : (
        <input
          type={field.type === "number" ? "number" : "text"}
          className={baseClass}
          placeholder={field.placeholder}
          value={value}
          onChange={handleChange}
        />
      )}
      {field.helpText && (
        <p className="text-xs text-muted-foreground">{field.helpText}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 认证模式选择器
// ---------------------------------------------------------------------------

function AuthModeSelector({
  modes,
  selected,
  onSelect,
}: {
  modes: AuthMode[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <select
      value={selected}
      onChange={(e) => onSelect(e.target.value)}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    >
      {modes.map((mode) => (
        <option key={mode.id} value={mode.id}>
          {mode.label}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function AgentSettingsForm({
  agent,
  modelProviders,
  onModelProviderChange,
  onSave,
  saving,
  onFetchModels,
  fetchingModels,
  availableModels,
  targetModelOptions,
}: AgentSettingsFormProps) {
  const descriptor = getAgentDescriptor(agent.agent_type);
  const [authMode, setAuthMode] = useState<string>(
    () => detectAuthMode(descriptor!, agent.env, agent.model_provider_id)
  );
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    if (descriptor) {
      const extracted = extractConfigFromDescriptor(descriptor, agent.env);
      for (const [k, v] of Object.entries(extracted)) {
        initial[k] = v;
      }
    }
    return initial;
  });

  // 切换认证模式时保存/恢复模型提供商字段值，避免两套模式互相污染
  const savedModelProviderValues = useRef<Record<string, string>>({});

  // Sync auth mode when the agent prop changes (e.g. after a provider
  // is saved, the parent re-renders with an updated model_provider_id).
  // Do NOT overwrite values — the user may have typed custom config.
  useEffect(() => {
    setAuthMode(detectAuthMode(descriptor!, agent.env, agent.model_provider_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.model_provider_id]);

  const handleFieldChange = useCallback(
    (key: string, value: string) => {
      setValues((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleAuthModeChange = useCallback(
    (modeId: string) => {
      setAuthMode(modeId);
      if (modeId !== "model_provider") {
        // 切换到 API Key 等非提供商模式：保存当前提供商字段值后清空，
        // 让用户从空白开始填写，不受提供商信息干扰。
        setValues((prev) => {
          savedModelProviderValues.current = prev;
          return {};
        });
      } else {
        // 切换回模型提供商模式：恢复之前保存的提供商字段值
        setValues(savedModelProviderValues.current);
      }
    },
    []
  );

  const currentAuthMode = descriptor?.authModes.find((m) => m.id === authMode);

  if (!descriptor) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        未知的智能体类型：{agent.agent_type}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 智能体信息 */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
          style={{ backgroundColor: descriptor.color }}
        >
          {descriptor.name.charAt(0)}
        </div>
        <div>
          <h3 className="font-semibold text-base">{descriptor.name}</h3>
          <p className="text-xs text-muted-foreground">{descriptor.description}</p>
        </div>
        <div className="ml-auto flex gap-1.5">
          {descriptor.runtimeDeps.map((dep) => (
            <span
              key={dep}
              className="px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground"
            >
              {dep}
            </span>
          ))}
        </div>
      </div>

      {/* 认证模式选择 */}
      <div>
        <label className="text-sm font-medium mb-2 block">认证方式</label>
        <AuthModeSelector
          modes={descriptor.authModes}
          selected={authMode}
          onSelect={handleAuthModeChange}
        />
      </div>

      {/* 配置字段 */}
      {currentAuthMode && (
        <div className="space-y-3">
          {currentAuthMode.fields.map((field) => {
            // 模型提供商选择器特殊处理
            if (field.key === "model_provider_id") {
              return (
                <div key={field.key} className="space-y-1.5">
                  <label className="text-sm font-medium">模型提供商</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={agent.model_provider_id ?? ""}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      onModelProviderChange?.(val);
                    }}
                  >
                    <option value="">选择模型提供商...</option>
                    {modelProviders?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    使用已配置的 API Key 和基础 URL，统一管理
                  </p>
                </div>
              );
            }
            if (field.key === "model" && authMode === "model_provider") {
              return (
                <div key={field.key} className="space-y-3">
                  {/* 提供商模型选择 */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">提供商模型</label>
                    <div className="flex gap-2">
                      <select
                        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={values["provider_model"] ?? ""}
                        onChange={(e) => handleFieldChange("provider_model", e.target.value)}
                      >
                        <option value="">{field.placeholder || "请选择..."}</option>
                        {availableModels?.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={onFetchModels}
                        disabled={fetchingModels}
                        className="shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                      >
                        {fetchingModels ? "加载中..." : "获取模型"}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">从提供商 API 拉取的可用模型列表</p>
                  </div>

                  {/* 目标模型映射 */}
                  {targetModelOptions && targetModelOptions.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">映射到智能体模型</label>
                      <select
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={values["model"] ?? ""}
                        onChange={(e) => handleFieldChange("model", e.target.value)}
                      >
                        <option value="">请选择目标模型...</option>
                        {targetModelOptions.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        提供商模型将通过此映射名称发送给智能体
                      </p>
                    </div>
                  )}
                </div>
              );
            }
            return (
              <ConfigFieldInput
                key={field.key}
                field={field}
                value={values[field.key] ?? ""}
                onChange={handleFieldChange}
              />
            );
          })}
        </div>
      )}

      {/* 配置文件列表 */}
      {descriptor.configFiles.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">配置文件</label>
          <div className="space-y-1">
            {descriptor.configFiles.map((cf) => (
              <div
                key={cf.relativePath}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <span className="px-1.5 py-0.5 rounded bg-muted font-mono">
                  {cf.format}
                </span>
                <span className="font-mono">~/{cf.relativePath}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            启动时自动生成，无需手动编辑
          </p>
        </div>
      )}

      {/* 保存按钮 */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={async () => {
            if (saving) return;
            await onSave?.(values, authMode);
          }}
          disabled={saving}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 从描述符和环境变量中提取配置值 */
function extractConfigFromDescriptor(
  descriptor: AgentDescriptor,
  env: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  const { baseUrlKey, apiKeyKey, modelKey } = descriptor.envMapping;

  if (env[apiKeyKey]) result[apiKeyKey] = env[apiKeyKey];
  if (env[baseUrlKey]) result[baseUrlKey] = env[baseUrlKey];
  if (env[modelKey]) result[modelKey] = env[modelKey];
  // "model" — 目标模型映射（PROVIDER_MAPPED_MODEL），用于"映射到智能体模型"下拉框。
  // 无映射时回退到 provider model。
  if (env["PROVIDER_MAPPED_MODEL"]) result["model"] = env["PROVIDER_MAPPED_MODEL"];
  else if (env[modelKey]) result["model"] = env[modelKey];
  // "provider_model" — 提供商模型，始终来自 modelKey（API 实际能识别的模型名）
  if (env[modelKey]) result["provider_model"] = env[modelKey];

  return result;
}