import { chromium, type Page } from "playwright"
import { Solari } from "@solarisdk/browser"

export interface BrowserSession {
  provider: "local" | "solari"
  /** Solari session id (recorded session; replay available after close). */
  sessionId?: string
  /** Opens an isolated page. Locally each call gets its own context (own window in visible mode). */
  newPage(): Promise<Page>
  close(): Promise<void>
}

export async function createBrowserSession(): Promise<BrowserSession> {
  if (process.env.EXECUTION_PROVIDER === "solari") {
    if (!process.env.SOLARI_API_KEY) {
      throw new Error("EXECUTION_PROVIDER=solari requires SOLARI_API_KEY")
    }
    const client = new Solari({ apiKey: process.env.SOLARI_API_KEY })
    const browser = await client.launch({ recording: true })
    return {
      provider: "solari",
      sessionId: browser.id,
      newPage: () => browser.newPage() as unknown as Promise<Page>,
      async close() {
        await browser.close()
        await client.close()
      },
    }
  }

  const visible = process.env.DEMO_MODE === "visible"
  const browser = await chromium.launch({
    headless: !visible,
    slowMo: visible ? 220 : 0,
  })
  return {
    provider: "local",
    async newPage() {
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
      return context.newPage()
    },
    close: () => browser.close(),
  }
}

export async function pause(page: Page, milliseconds = 520): Promise<void> {
  if (process.env.DEMO_MODE === "visible") await page.waitForTimeout(milliseconds * Number(process.env.DEMO_PACE ?? 1))
}
