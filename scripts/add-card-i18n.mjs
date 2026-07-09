import { readFileSync, writeFileSync } from "fs"

const LANG_DIR = "src/i18n/messages"

const newKeys = {
  en: {
    install: "Install",
    uninstall: "Uninstall",
    installSuccess: "Installed successfully",
    uninstallSuccess: "Uninstalled successfully",
    installFailed: "Install failed: {error}",
    uninstallFailed: "Uninstall failed: {error}",
    active: "Active",
    installedPlugins: "Installed Plugins",
  },
  "zh-CN": {
    install: "安装",
    uninstall: "卸载",
    installSuccess: "安装成功",
    uninstallSuccess: "卸载成功",
    installFailed: "安装失败：{error}",
    uninstallFailed: "卸载失败：{error}",
    active: "已启用",
    installedPlugins: "已安装的插件",
  },
  "zh-TW": {
    install: "安裝",
    uninstall: "解除安裝",
    installSuccess: "安裝成功",
    uninstallSuccess: "解除安裝成功",
    installFailed: "安裝失敗：{error}",
    uninstallFailed: "解除安裝失敗：{error}",
    active: "已啟用",
    installedPlugins: "已安裝的外掛",
  },
  ja: {
    install: "インストール",
    uninstall: "アンインストール",
    installSuccess: "インストールしました",
    uninstallSuccess: "アンインストールしました",
    installFailed: "インストール失敗：{error}",
    uninstallFailed: "アンインストール失敗：{error}",
    active: "アクティブ",
    installedPlugins: "インストール済みプラグイン",
  },
  ko: {
    install: "설치",
    uninstall: "제거",
    installSuccess: "설치 완료",
    uninstallSuccess: "제거 완료",
    installFailed: "설치 실패: {error}",
    uninstallFailed: "제거 실패: {error}",
    active: "활성",
    installedPlugins: "설치된 플러그인",
  },
  es: {
    install: "Instalar",
    uninstall: "Desinstalar",
    installSuccess: "Instalado correctamente",
    uninstallSuccess: "Desinstalado correctamente",
    installFailed: "Error al instalar: {error}",
    uninstallFailed: "Error al desinstalar: {error}",
    active: "Activo",
    installedPlugins: "Plugins instalados",
  },
  de: {
    install: "Installieren",
    uninstall: "Deinstallieren",
    installSuccess: "Erfolgreich installiert",
    uninstallSuccess: "Erfolgreich deinstalliert",
    installFailed: "Installation fehlgeschlagen: {error}",
    uninstallFailed: "Deinstallation fehlgeschlagen: {error}",
    active: "Aktiv",
    installedPlugins: "Installierte Plugins",
  },
  fr: {
    install: "Installer",
    uninstall: "Désinstaller",
    installSuccess: "Installé avec succès",
    uninstallSuccess: "Désinstallé avec succès",
    installFailed: "Échec de l'installation : {error}",
    uninstallFailed: "Échec de la désinstallation : {error}",
    active: "Actif",
    installedPlugins: "Plugins installés",
  },
  pt: {
    install: "Instalar",
    uninstall: "Desinstalar",
    installSuccess: "Instalado com sucesso",
    uninstallSuccess: "Desinstalado com sucesso",
    installFailed: "Falha na instalação: {error}",
    uninstallFailed: "Falha na desinstalação: {error}",
    active: "Ativo",
    installedPlugins: "Plugins instalados",
  },
  ar: {
    install: "تثبيت",
    uninstall: "إزالة",
    installSuccess: "تم التثبيت بنجاح",
    uninstallSuccess: "تمت الإزالة بنجاح",
    installFailed: "فشل التثبيت: {error}",
    uninstallFailed: "فشل الإزالة: {error}",
    active: "نشط",
    installedPlugins: "الإضافات المثبتة",
  },
}

for (const [lang, keys] of Object.entries(newKeys)) {
  const file = `${LANG_DIR}/${lang}.json`
  let content = readFileSync(file, "utf8")

  // Find the last key in SkillsAndTools namespace and append new keys
  // The namespace ends with:   "noPlugins": "..."
  // We add new keys after that, before the closing }
  const entries = Object.entries(keys)
    .map(([key, value]) => `    "${key}": "${value}"`)
    .join(",\n")

  // Find the SkillsAndTools namespace's last entry and append after it
  content = content.replace(
    /("noPlugins":\s*"[^"]*")(\s*\})/,
    `$1,\n${entries}$2`
  )

  writeFileSync(file, content)
  console.log(`✅ ${lang}`)
}

console.log("\nDone! Added card UI i18n keys.")
