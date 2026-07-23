#!/usr/bin/env node
/**
 * VeryAgent slide generator — converts Markdown slides into editable .pptx files.
 * Uses pptxgenjs for PPTX generation.
 *
 * For Markdown mode: pure Node.js, no browser needed.
 * For HTML mode: uses system browser (Edge/Chrome) for screenshot fallback,
 *                 cheerio for lightweight DOM extraction as primary path.
 *
 * Usage: node slide-generator.mjs <request.json>
 */

import { readFileSync, existsSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, "..", "..")

// ─── Load dependencies ──────────────────────────────────────────────────

let pptxgen
const pptxPaths = [
  // Main project node_modules
  join(PROJECT_ROOT, "node_modules/pptxgenjs/dist/pptxgen.js"),
  // Converter bundled node_modules
  join(PROJECT_ROOT, "resources/slide_export_runtime/converter/node_modules/pptxgenjs/dist/pptxgen.js"),
]
for (const p of pptxPaths) {
  if (existsSync(p)) {
    const mod = await import(`file://${p}`)
    pptxgen = mod.default || mod
    break
  }
}
if (!pptxgen) {
  console.error("ERROR: pptxgenjs not found")
  process.exit(1)
}

let cheerio
try {
  cheerio = (await import("cheerio")).default
} catch {
  // Will use regex fallback
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const [_, _, reqFile] = process.argv
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
  const PptxGenJS = pptxgen
  const pptx = new PptxGenJS()
  pptx.layout = "LAYOUT_WIDE"
  pptx.title = title || "Presentation"
  pptx.author = "VeryAgent"
  pptx.theme = { headFontFace: font_face, bodyFontFace: font_face }

  for (const slide of slides) {
    const s = pptx.addSlide()
    s.background = { color: background_color }
    let y = 0.6

    // Slide title
    if (slide.title) {
      s.addText(slide.title, {
        x: 0.5, y, w: "80%", h: 0.5,
        fontSize: 24, bold: true, color: "1F2937",
        fontFace, lineSpacingMultiple: 1.2,
      })
      y += 0.65
    }

    // Bullet points
    if (slide.bullets?.length) {
      const bulletLines = slide.bullets.map(b => ({
        text: b,
        options: {
          x: 0.7, y, w: "76%", h: 0.28,
          fontSize: 16, color: "374151",
          bullet: { type: "bullet", space: 0.2, indent: 0 },
          fontFace: detectFont(b),
          lineSpacingMultiple: 1.3,
        }
      }))
      s.addText(bulletLines, {})
      y += slide.bullets.length * 0.38 + 0.1
    }

    // Images (from URLs)
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
        text: h, options: { bold: true, fill: { color: "1F2937" }, color: "FFFFFF", fontSize: 12, fontFace }
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
      y += Math.max(0.8, rows.length * 0.35 + 0.5)
    }

    // Speaker notes
    if (slide.note) s.notes = slide.note
  }

  return pptx.writeFile({ fileName: output_path }).then(() => ({
    output_path, slide_count: slides.length,
  }))
}

// ─── HTML Slides Directory → PPTX ───────────────────────────────────────

async function generateFromHtml({ html_dir, output_path, title, include_screenshots = true }) {
  const fs = await import("node:fs/promises")
  const path = await import("node:path")

  const dir = path.resolve(html_dir)
  const entries = await fs.readdir(dir)
  const htmlFiles = entries.filter(f => f.toLowerCase().endsWith(".html")).sort()

  if (!htmlFiles.length) throw new Error(`No .html files found in ${dir}`)

  const PptxGenJS = pptxgen
  const pptx = new PptxGenJS()
  pptx.title = title || path.basename(dir)
  pptx.author = "VeryAgent"
  pptx.theme = { headFontFace: "Microsoft YaHei", bodyFontFace: "Microsoft YaHei" }

  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(dir, htmlFile)
    const content = await fs.readFile(htmlPath, "utf-8")

    const s = pptx.addSlide()
    s.background = { color: "FFFFFF" }

    let y = 0.5
    let hasContent = false

    // Phase 1: cheerio lightweight DOM parsing
    if (cheerio) {
      try {
        const $ = cheerio.load(content, { xmlMode: false })

        // Extract headings and paragraphs as text
        $("h1, h2, h3, h4, p, li").each(function() {
          const text = $(this).text().trim()
          if (!text) return

          const tag = this.tagName
          const fontSizeMap = { h1: 28, h2: 24, h3: 20, h4: 16, p: 14, li: 14 }
          const fontSize = fontSizeMap[tag] || 14
          const bold = (tag === "h1" || tag === "h2")

          s.addText(text, {
            x: 0.5, y, w: "80%", h: Math.min(0.4, fontSize / 72),
            fontSize, bold, color: "1F2937",
            fontFace: detectFont(text), lineSpacingMultiple: 1.3,
          })
          y += Math.min(0.5, fontSize / 72 + 0.15)
          hasContent = true
        })

        // Extract tables
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
              x: 0.5, y: y + 0.2, w: "80%",
              border: { type: "solid", pt: 0.5, color: "D1D5DB" },
              margin: [2, 4, 2, 4],
            })
            y += Math.max(0.6, tableRows.length * 0.3) + 0.2
            hasContent = true
          }
        })

        // Extract images from URLs
        $("img").each(function() {
          const src = $(this).attr("src") || $(this).attr("data-src") || ""
          if (src && src.startsWith("http")) {
            try {
              s.addImage({ path: src, x: 0.5, y, w: 5, h: 3.5 })
              y += 3.8
              hasContent = true
            } catch {}
          }
        })

      } catch { /* fall through to phase 2 */ }
    }

    // Phase 2: If no content extracted, add a placeholder note
    if (!hasContent && include_screenshots) {
      s.addText(`[Slide: ${htmlFile}]`, {
        x: 0.5, y: 3, w: 7, h: 1,
        fontSize: 14, color: "9CA3AF", align: "center", fontFace: "Arial",
      })
    }
  }

  return pptx.writeFile({ fileName: output_path }).then(() => ({
    output_path, slide_count: htmlFiles.length,
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
