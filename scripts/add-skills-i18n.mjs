import { readFileSync, writeFileSync } from "fs"

const LANG_DIR = "src/i18n/messages"

const sidebarTranslations = {
  en: "Skills & Tools",
  "zh-CN": "技能和工具",
  "zh-TW": "技能與工具",
  ja: "スキルとツール",
  ko: "스킬 및 도구",
  es: "Habilidades y herramientas",
  de: "Fähigkeiten und Werkzeuge",
  fr: "Compétences et outils",
  pt: "Habilidades e ferramentas",
  ar: "المهارات والأدوات",
}

const skillsAndToolsTranslations = {
  en: {
    title: "Skills & Tools",
    tabCurrentAgent: "Current Agent",
    tabSkillsRepo: "Skills",
    tabPluginsRepo: "Plugins",
    loading: "Loading\u2026",
    active: "Active",
    noAgent: "No agent available",
    enabledSkills: "Enabled Skills",
    noSkills: "No skills available",
    codingExperts: "Coding Experts",
    noExperts: "No experts available",
    officeSkills: "Office Skills",
    noOfficeSkills: "No office skills available",
    installedPlugins: "Installed Plugins",
    noPlugins: "No plugins installed",
  },
  "zh-CN": {
    title: "技能和工具",
    tabCurrentAgent: "当前智能体",
    tabSkillsRepo: "技能",
    tabPluginsRepo: "插件",
    loading: "加载中…",
    active: "活跃",
    noAgent: "没有可用的智能体",
    enabledSkills: "已启用的技能",
    noSkills: "没有可用的技能",
    codingExperts: "编程专家",
    noExperts: "没有可用的专家",
    officeSkills: "Office 技能",
    noOfficeSkills: "没有可用的 Office 技能",
    installedPlugins: "已安装的插件",
    noPlugins: "没有安装插件",
  },
  "zh-TW": {
    title: "技能和工具",
    tabCurrentAgent: "當前智能體",
    tabSkillsRepo: "技能",
    tabPluginsRepo: "外掛",
    loading: "載入中…",
    active: "活躍",
    noAgent: "沒有可用的智能體",
    enabledSkills: "已啟用的技能",
    noSkills: "沒有可用的技能",
    codingExperts: "程式專家",
    noExperts: "沒有可用的專家",
    officeSkills: "Office 技能",
    noOfficeSkills: "沒有可用的 Office 技能",
    installedPlugins: "已安裝的外掛",
    noPlugins: "沒有安裝外掛",
  },
  ja: {
    title: "スキルとツール",
    tabCurrentAgent: "現在のエージェント",
    tabSkillsRepo: "スキル",
    tabPluginsRepo: "プラグイン",
    loading: "読み込み中…",
    active: "アクティブ",
    noAgent: "利用可能なエージェントがありません",
    enabledSkills: "有効なスキル",
    noSkills: "利用可能なスキルがありません",
    codingExperts: "コーディングエキスパート",
    noExperts: "利用可能なエキスパートがありません",
    officeSkills: "Office スキル",
    noOfficeSkills: "利用可能な Office スキルがありません",
    installedPlugins: "インストール済みプラグイン",
    noPlugins: "プラグインがインストールされていません",
  },
  ko: {
    title: "스킬 및 도구",
    tabCurrentAgent: "현재 에이전트",
    tabSkillsRepo: "스킬",
    tabPluginsRepo: "플러그인",
    loading: "로딩 중…",
    active: "활성",
    noAgent: "사용 가능한 에이전트가 없습니다",
    enabledSkills: "활성화된 스킬",
    noSkills: "사용 가능한 스킬이 없습니다",
    codingExperts: "코딩 전문가",
    noExperts: "사용 가능한 전문가가 없습니다",
    officeSkills: "Office 스킬",
    noOfficeSkills: "사용 가능한 Office 스킬이 없습니다",
    installedPlugins: "설치된 플러그인",
    noPlugins: "설치된 플러그인이 없습니다",
  },
  es: {
    title: "Habilidades y herramientas",
    tabCurrentAgent: "Agente actual",
    tabSkillsRepo: "Habilidades",
    tabPluginsRepo: "Plugins",
    loading: "Cargando…",
    active: "Activo",
    noAgent: "No hay agentes disponibles",
    enabledSkills: "Habilidades activadas",
    noSkills: "No hay habilidades disponibles",
    codingExperts: "Expertos en programación",
    noExperts: "No hay expertos disponibles",
    officeSkills: "Habilidades de Office",
    noOfficeSkills: "No hay habilidades de Office disponibles",
    installedPlugins: "Plugins instalados",
    noPlugins: "No hay plugins instalados",
  },
  de: {
    title: "Fähigkeiten und Werkzeuge",
    tabCurrentAgent: "Aktueller Agent",
    tabSkillsRepo: "Fähigkeiten",
    tabPluginsRepo: "Plugins",
    loading: "Laden…",
    active: "Aktiv",
    noAgent: "Keine Agenten verfügbar",
    enabledSkills: "Aktivierte Fähigkeiten",
    noSkills: "Keine Fähigkeiten verfügbar",
    codingExperts: "Programmierexperten",
    noExperts: "Keine Experten verfügbar",
    officeSkills: "Office-Fähigkeiten",
    noOfficeSkills: "Keine Office-Fähigkeiten verfügbar",
    installedPlugins: "Installierte Plugins",
    noPlugins: "Keine Plugins installiert",
  },
  fr: {
    title: "Compétences et outils",
    tabCurrentAgent: "Agent actuel",
    tabSkillsRepo: "Compétences",
    tabPluginsRepo: "Plugins",
    loading: "Chargement…",
    active: "Actif",
    noAgent: "Aucun agent disponible",
    enabledSkills: "Compétences activées",
    noSkills: "Aucune compétence disponible",
    codingExperts: "Experts en codage",
    noExperts: "Aucun expert disponible",
    officeSkills: "Compétences Office",
    noOfficeSkills: "Aucune compétence Office disponible",
    installedPlugins: "Plugins installés",
    noPlugins: "Aucun plugin installé",
  },
  pt: {
    title: "Habilidades e ferramentas",
    tabCurrentAgent: "Agente atual",
    tabSkillsRepo: "Habilidades",
    tabPluginsRepo: "Plugins",
    loading: "Carregando…",
    active: "Ativo",
    noAgent: "Nenhum agente disponível",
    enabledSkills: "Habilidades ativadas",
    noSkills: "Nenhuma habilidade disponível",
    codingExperts: "Especialistas em programação",
    noExperts: "Nenhum especialista disponível",
    officeSkills: "Habilidades do Office",
    noOfficeSkills: "Nenhuma habilidade do Office disponível",
    installedPlugins: "Plugins instalados",
    noPlugins: "Nenhum plugin instalado",
  },
  ar: {
    title: "المهارات والأدوات",
    tabCurrentAgent: "الوكيل الحالي",
    tabSkillsRepo: "المهارات",
    tabPluginsRepo: "الإضافات",
    loading: "جارٍ التحميل…",
    active: "نشط",
    noAgent: "لا يوجد وكلاء متاحون",
    enabledSkills: "المهارات المفعّلة",
    noSkills: "لا توجد مهارات متاحة",
    codingExperts: "خبراء البرمجة",
    noExperts: "لا يوجد خبراء متاحون",
    officeSkills: "مهارات Office",
    noOfficeSkills: "لا توجد مهارات Office متاحة",
    installedPlugins: "الإضافات المثبتة",
    noPlugins: "لا توجد إضافات مثبتة",
  },
}

for (const [lang, sidebarLabel] of Object.entries(sidebarTranslations)) {
  const file = `${LANG_DIR}/${lang}.json`
  let content = readFileSync(file, "utf8")
  const translations = skillsAndToolsTranslations[lang]

  // 1. Add "skillsAndTools" to Folder.sidebar namespace (only if not already present)
  if (!content.includes('"skillsAndTools"')) {
    content = content.replace(
      /("automations"\s*:\s*"[^"]*",)/,
      `$1\n      "skillsAndTools": "${sidebarLabel}",`
    )
  }

  // 2. Remove the previously broken SkillsAndTools block if present
  // (from the earlier failed script run)
  const brokenMatch = content.match(/,\n  "SkillsAndTools": \{[^}]*\}\n\}/s)
  if (brokenMatch) {
    content = content.replace(brokenMatch[0], "\n}")
  }

  // 3. Add SkillsAndTools namespace properly: replace the FINAL "}" (root closing)
  // with the new namespace + closing brace
  const trimmed = content.trimEnd()
  if (trimmed.endsWith("}")) {
    const entries = Object.entries(translations)
      .map(([key, value]) => `    "${key}": "${value}"`)
      .join(",\n")
    const newBlock = `,\n  "SkillsAndTools": {\n${entries}\n  }\n}`
    content = trimmed.slice(0, -1) + newBlock
  }

  writeFileSync(file, content)
  console.log(`✅ ${lang}`)
}

console.log("\nDone! Fixed i18n files.")
