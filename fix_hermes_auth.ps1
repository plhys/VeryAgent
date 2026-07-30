
$f = "D:\AICODE\VeryAgent\src\components\settings\acp-agent-settings.tsx"
$c = Get-Content $f -Raw

$old = "  const handleHermesAuthModeChange = useCallback(`r`n    (nextMode: HermesAuthMode) => {`r`n      if (`r`n        !selectedAgent ||`r`n        !selectedDraft ||`r`n        selectedAgent.agent_type !== `"hermes`"`r`n      )`r`n        return`r`n      updateSelectedDraft((current) => ({`r`n        ...current,`r`n        hermesAuthMode: nextMode,`r`n        modelProviderId:`r`n          nextMode === `"model_provider`" ? current.modelProviderId : null,`r`n      }))`r`n    },`r`n    [selectedAgent, selectedDraft, updateSelectedDraft]`r`n  )"

$new = "  const handleHermesAuthModeChange = useCallback(`r`n    (nextMode: HermesAuthMode) => {`r`n      if (`r`n        !selectedAgent ||`r`n        !selectedDraft ||`r`n        selectedAgent.agent_type !== `"hermes`"`r`n      )`r`n        return`r`n      updateSelectedDraft((current) => {`r`n        if (nextMode !== `"model_provider`") {`r`n          return { ...current, hermesAuthMode: nextMode, modelProviderId: null }`r`n        }`r`n        const provider = modelProviders.find((p) => p.id === current.modelProviderId)`r`n        if (!provider) {`r`n          return { ...current, hermesAuthMode: nextMode }`r`n        }`r`n        let modelName = `"`"`r`n        if (provider.model) {`r`n          try { const parsed = JSON.parse(provider.model); modelName = parsed.main || `"`" }`r`n          catch { modelName = provider.model }`r`n        }`r`n        return {`r`n          ...current,`r`n          hermesAuthMode: nextMode,`r`n          apiKey: provider.api_key,`r`n          apiBaseUrl: provider.api_url,`r`n          model: modelName,`r`n        }`r`n      })`r`n    },`r`n    [selectedAgent, selectedDraft, updateSelectedDraft, modelProviders]`r`n  )"

$c = $c -replace [regex]::Escape($old), $new
Set-Content -Path $f -Value $c -Encoding UTF8
Write-Output "done"
