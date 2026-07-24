#!/usr/bin/env node
/**
 * VeryAgent slide generator — converts Markdown or HTML slides into editable .pptx files.
 *
 * Strategy:
 * - Markdown mode: direct pptxgenjs generation (fast, no browser).
 * - HTML mode: uses system WebView2 via Tauri to render slides for screenshot fidelity,
 *   then overlays editable text/tables/images on top.
 *
 * In standalone mode (no Tauri host), falls back to cheerio DOM parsing only
 * (faster but less visually accurate).
 *
 * Usage: node slide-generator.mjs <request.json>
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Load dependencies ──────────────────────────────────────────────────

let pptxgen
const findPptxGenJS = async () => {
  const paths = [
    // Main project node_modules
    join(__dirname, "..", "..", "..", "node_modules/pptxgenjs/dist/pptxgen.es.js"),
    join(__dirname, "..", "..", "node_modules/pptxgenjs/dist/pptxgen.es.js"),
    // Converter bundled node_modules
    join(__dirname, "..", "..", "node_modules", "pptxgenjs", "dist", "pptxgen.es.js"),
  ]

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const mod = await import(`file://${p}`)
        return mod.default || mod.PptxGenJS || mod
      } catch {}
    }
  }
  return null
}

const cheerio = await import("cheerio").catch(() => null)

if (!await findPptxGenJS()) {
  console.error("ERROR: pptxgenjs not found")
  process.exit(1)
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const reqFile = process.argv[2]
  if (!reqFile) {
    console.error("Usage: slide-generator.mjs <request.json>")
    process.exit(1)
  }

  const reqRaw = readFileSync(reqFile, "utf-8")
  const req = JSON.parse(reqRaw)

  let result
  switch (req.mode) {
    case "markdown":
      result = generateFromMarkdown(req)
      break
    case "html":
      result = await generateFromHtml(req)
      break
    default:
      throw new Error(`Unknown mode: ${req.mode}`)
  }

  process.stdout.write(JSON.stringify(result))
}

// ─── Markdown → PPTX ────────────────────────────────────────────────────

function generateFromMarkdown({ title, slides, output_path, background_color = "#FFFFFF", font_face = "Microsoft YaHei" }) {
  return (async () => {
    const PptxGenJS = await findPptxGenJS()
    const pptx = new PptxGenJS()
    pptx.layout = "LAYOUT_WIDE"
    pptx.title = title || "Presentation"
    pptx.author = "VeryAgent"
    pptx.theme = { headFontFace: font_face, bodyFontFace: font_face }

    for (const slide of slides) {
      const s = pptx.addSlide()
      s.background = { color: background_color }
      let y = 0.6

      // Title
      if (slide.title) {
        s.addText(slide.title, {
          x: 0.5, y, w: "80%", h: 0.5,
          fontSize: 24, bold: true, color: "1F2937",
          fontFace: font_face, lineSpacingMultiple: 1.2,
        })
        y += 0.65
      }

      // Bullets
      if (slide.bullets?.length) {
        const lines = slide.bullets.map(b => ({
          text: b,
          options: {
            x: 0.7, y, w: "76%", h: 0.28,
            fontSize: 16, color: "374151",
            bullet: { type: "bullet", space: 0.2, indent: 0 },
            fontFace: detectFont(b), lineSpacingMultiple: 1.3,
          }
        }))
        s.addText(lines, {})
        y += slide.bullets.length * 0.38 + 0.1
      }

      // Images
      if (slide.images?.length) {
        for (const img of slide.images) {
          const imgY = y + 0.2
          if (img.url && img.url.startsWith("http")) {
            try { s.addImage({ path: img.url, x: 0.5, y: imgY, w: 6, h: 4 }) } catch {}
          }
          if (img.caption) {
            s.addText(img.caption, {
              x: 0.5, y: imgY + 4.1, w: 6, h: 0.25,
              fontSize: 10, color: "6B7280", italic: true,
              align: "center", fontFace: detectFont(img.caption),
            })
          }
          y = imgY + 4.6
        }
      }

      // Table
      if (slide.table) {
        const { headers, rows } = slide.table
        const tableRows = [headers.map(h => ({
          text: h, options: { bold: true, fill: { color: "1F2937" }, color: "FFFFFF", fontSize: 12, fontFace: font_face }
        }))]
        for (const row of rows) {
          tableRows.push(row.map(text => ({
            text: text || "", options: { fontSize: 11, fontFace: detectFont(text || "") }
          })))
        }
        s.addTable(tableRows, {
          x: 0.5, y: y + 0.2, w: "80%",
          border: { type: "solid", pt: 0.5, color: "D1D5DB" },
          margin: [4, 8, 4, 8],
        })
      }

      // Speaker notes
      if (slide.note) s.notes = slide.note
    }

    return pptx.writeFile({ fileName: output_path }).then(filePath => ({
      output_path: filePath, slide_count: slides.length,
    }))
  })()
}

// ─── HTML → PPTX (WebView2 screenshot + DOM extraction) ──────────────────

async function generateFromHtml({ html_dir, output_path, title, use_screenshot_fidelity = true }) {
  const fs = await import("node:fs/promises")
  const path = await import("node:path")

  const dir = path.resolve(html_dir)
  const entries = await fs.readdir(dir)
  const htmlFiles = entries.filter(f => f.toLowerCase().endsWith(".html")).sort()

  if (!htmlFiles.length) throw new Error(`No .html files found in ${dir}`)

  const PptxGenJS = await findPptxGenJS()
  const pptx = new PptxGenJS()
  pptx.title = title || path.basename(dir)
  pptx.author = "VeryAgent"
  pptx.theme = { headFontFace: "Microsoft YaHei", bodyFontFace: "Microsoft YaHei" }

  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(dir, htmlFile)
    const content = await fs.readFile(htmlPath, "utf-8")

    const s = pptx.addSlide()
    s.background = { color: "FFFFFF" }

    if (use_screenshot_fidelity) {
      // Phase 1: Render screenshot via WebView2 (if running inside Tauri)
      // For standalone Node, we use a temp headless approach with Puppeteer-like rendering
      // since the Rust side can create a hidden WebView2 window and call captureToBytes.
      // Here we add a placeholder; the Rust side injects screenshots later.
      const { execFile } = await import("node:child_process")
      const util = await import("node:util")
      const execFilePromise = util.promisify(execFile)

      // Try to use the built-in Tauri screenshot endpoint
      // When running from Tauri, the Rust code pre-captures screenshots
      // and passes their paths as screenshotPaths in the request
      const screenshotPaths = (this.screenshotPaths || [])
      if (screenshotPaths.length === htmlFiles.length) {
        try {
          const scPath = screenshotPaths[htmlFiles.indexOf(htmlFile)]
          if (existsSync(scPath)) {
            s.addImage({ path: scPath, x: 0, y: 0, w: "100%", h: "100%" })
          }
        } catch {}
      }

      // Phase 2: Lightweight DOM extraction for editable elements
      if (cheerio) {
        try {
          const $ = cheerio.load(content, { xmlMode: false })
          let y = 0.3

          // Headings
          $("h1, h2, h3, h4, p, li").each(function() {
            const text = $(this).text().trim()
            if (!text) return
            const tag = this.tagName
            const sizeMap = { h1: 32, h2: 24, h3: 20, h4: 16, p: 14, li: 14 }
            const fontSize = sizeMap[tag] || 14
            const bold = ["h1", "h2"].includes(tag)

            s.addText(text, {
              x: 0.6, y: y + 0.3, w: "80%", h: Math.min(0.5, fontSize / 72),
              fontSize, bold, color: "1F2937",
              fontFace: detectFont(text), lineSpacingMultiple: 1.3,
            })
            y += Math.min(0.6, fontSize / 72 + 0.2)
          })

          // Tables
          $("table").each(function() {
            const tableRows = []
            $(this).find("tr").each(function() {
              const row = []
              $(this).find("td, th").each(function() {
                row.push({
                  text: $(this).text().trim() || "",
                  options: {
                    fontSize: 11, bold: this.tagName === "th",
                    fontFace: detectFont($(this).text()),
                  }
                })
              })
              tableRows.push(row)
            })
            if (tableRows.length > 0) {
              s.addTable(tableRows, {
                x: 0.5, y: y + 0.4, w: "80%",
                border: { type: "solid", pt: 0.5, color: "D1D5DB" },
                margin: [2, 4, 2, 4],
              })
              y += Math.max(0.7, tableRows.length * 0.3) + 0.3
            }
          })

          // Images
          $("img").each(function() {
            const src = $(this).attr("src") || $(this).attr("data-src") || ""
            if (src && src.startsWith("http")) {
              try {
                s.addImage({ path: src, x: 0.5, y: y + 0.3, w: 5, h: 3.5 })
                y += 4
              } catch {}
            }
          })
        } catch {}
      }
    } else {
      // No screenshot mode — pure cheerio parsing
      if (cheerio) {
        try {
          const $ = cheerio.load(content, { xmlMode: false })
          let y = 0.5
          $("h1, h2, h3, p, li").each(function() {
            const text = $(this).text().trim()
            if (!text) return
            const tag = this.tagName
            const sizeMap = { h1: 32, h2: 24, h3: 20, p: 14, li: 14 }
            const fontSize = sizeMap[tag] || 14
            s.addText(text, {
              x: 0.6, y, w: "80%", h: 0.4,
              fontSize, bold: ["h1", "h2"].includes(tag),
              color: "1F2937", fontFace: detectFont(text),
            })
            y += 0.5
          })
        } catch {}
      }
    }
  }

  return pptx.writeFile({ fileName: output_path }).then(filePath => ({
    output_path: filePath, slide_count: htmlFiles.length,
  }))
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function detectFont(text) {
  if (/[\u3400-\u9fff\uF900-\uFAFF\u4E00-\u9FFF]/.test(text)) return "Microsoft YaHei"
  return "Arial"
}

main().catch(err => {
  console.error("Generator error:", err.message || err)
  process.exit(1)
})
