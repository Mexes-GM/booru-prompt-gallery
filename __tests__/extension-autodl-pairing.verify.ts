/**
 * Verification tests for how SeaArt auto-download pairs a finished image with
 * the prompt it was generated from (extension/sidepanel/12-autodl.js).
 *
 * The extension's own scripts are loaded as-is into `vm` contexts instead of
 * being copied here:
 *   - the side panel context runs 11-ledger.js + 12-autodl.js with stubbed
 *     chrome APIs;
 *   - the page context runs installAutoDownloadObserverInPage and the arm
 *     helpers the way chrome.scripting.executeScript would (serialized source
 *     plus args) against a minimal DOM shaped like SeaArt's ComfyUI history
 *     list: one `.c-workflow-history-item` card per task, inserted at the top
 *     when the task is created, with the task's images rendered inside it.
 *
 * Covers:
 *   1. Images that finish out of send order each get their own prompt when
 *      their card carries the jobId (the case that used to swap prompts).
 *   2. With no jobId and no prompt text in the card, two or more pending
 *      prompts give no prompt at all instead of the oldest one; a single
 *      pending prompt is still used.
 *   3. A jobId whose prompt is not in the pool (fast finish, or a second image
 *      of the same task) resolves from the ledger, and the late pool entry is
 *      not left behind for an unrelated image.
 *   4. Content matching on the card's prompt text still works.
 *   5. Page side: the card created after an arm is tagged with that job, in
 *      any completion order; disarmed clicks, list reloads, cards loaded by
 *      scrolling and generations started outside the queue are not tagged; a
 *      card that could belong to either of two jobs is left untagged.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/extension-autodl-pairing.verify.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import * as vm from "node:vm"

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

const sidepanelDir = path.join(__dirname, "..", "extension", "sidepanel")
const readScript = (name: string) => fs.readFileSync(path.join(sidepanelDir, name), "utf8")
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} }

// ─────────────────────────────────────────────────────────────────────────────
// Side panel context
// ─────────────────────────────────────────────────────────────────────────────

function createSidepanel() {
  const pageCalls: Array<{ func: string; args: unknown[] }> = []
  let onMessage: ((msg: any, sender: any) => void) | null = null
  const ctx: any = {
    console: quiet,
    autoDownloadEnabled: true,
    currentPlatform: "SeaArt",
    characterSubfoldersEnabled: true,
    persistLedger() {},
    persistQueue() {},
    updateQueueUI() {},
    processNext() {},
    dlog() {},
    chrome: {
      runtime: {
        lastError: undefined,
        onMessage: { addListener: (fn: any) => { onMessage = fn } },
        sendMessage: async () => ({}),
      },
      scripting: {
        executeScript: (opts: any, cb?: () => void) => {
          pageCalls.push({ func: opts.func.name, args: opts.args || [] })
          cb?.()
        },
      },
    },
  }
  vm.createContext(ctx)
  vm.runInContext(readScript("11-ledger.js"), ctx, { filename: "11-ledger.js" })
  vm.runInContext(readScript("12-autodl.js"), ctx, { filename: "12-autodl.js" })
  const run = (code: string) => vm.runInContext(code, ctx)
  return { ctx, run, pageCalls, getOnMessage: () => onMessage! }
}

const PROMPTS = [
  "An anime-style illustration of a fox girl in a kitchen, holding a spoon, with very long silver hair.",
  "safe, 1girl, solo, fox girl, silver hair, very long hair, kitchen, holding spoon",
  "A knight in red armor stands in a snowy forest at night, holding a lantern.",
  "safe, 1boy, solo, knight, red armor, snow, forest, night, holding lantern",
  "sensitive, 1girl, solo, swimsuit, beach, blue sky, cloud",
  "safe, 1boy, 1girl, couple, white background, cowboy shot",
]

// ── 1) Out-of-order completions pair by jobId ──
{
  const sp = createSidepanel()
  const jobIds: string[] = PROMPTS.map((p, i) => sp.run(`ledgerCreate(${JSON.stringify(p)}, ${i === 0 ? '"fox_girl"' : "undefined"})`))
  for (let i = 0; i < PROMPTS.length; i++) {
    sp.run(`recordSentPrompt({ prompt: ${JSON.stringify(PROMPTS[i])}, character: ${i === 0 ? '"fox_girl"' : "undefined"}, jobId: ${JSON.stringify(jobIds[i])} })`)
  }
  // Same shape as the swapped pairs seen in practice: neighbours finishing in
  // reverse order, while the pool still holds several prompts.
  const finishOrder = [0, 2, 1, 4, 3, 5]
  for (const i of finishOrder) {
    const match = sp.run(`matchSentPromptForImage("", ${JSON.stringify(jobIds[i])})`)
    assert(match.prompt === PROMPTS[i], `image of job ${i + 1} gets its own prompt (got "${String(match.prompt).slice(0, 30)}")`)
    assert(match.jobId === jobIds[i], `image of job ${i + 1} reports its own jobId`)
    assert(match.source === "job-id", `image of job ${i + 1} paired through the jobId`)
  }
  const first = sp.run(`ledgerGet(${JSON.stringify(jobIds[0])})`)
  assert(first.character === "fox_girl", "ledger keeps the character for job 1")
  assert(sp.run("sentPromptsQueue.length") === 0, "every pool entry consumed once")
}

// ── 2) No key: never guess between several pending prompts ──
{
  const sp = createSidepanel()
  const jobIds: string[] = PROMPTS.slice(0, 3).map((p) => sp.run(`ledgerCreate(${JSON.stringify(p)})`))
  jobIds.forEach((id, i) => sp.run(`recordSentPrompt({ prompt: ${JSON.stringify(PROMPTS[i])}, jobId: ${JSON.stringify(id)} })`))

  const unkeyed = sp.run(`matchSentPromptForImage("", "")`)
  assert(unkeyed.source === "unpaired", "no jobId, no card text, 3 pending → unpaired")
  assert(unkeyed.prompt === "", "unpaired image gets no prompt (not the oldest one)")
  assert(unkeyed.jobId === undefined, "unpaired image is not attributed to any job")
  assert(sp.run("sentPromptsQueue.length") === 3, "unpaired image leaves the pool intact")

  sp.run(`matchSentPromptForImage("", ${JSON.stringify(jobIds[0])})`)
  sp.run(`matchSentPromptForImage("", ${JSON.stringify(jobIds[2])})`)
  const single = sp.run(`matchSentPromptForImage("", "")`)
  assert(single.source === "single-pending", "only one prompt pending → it is used")
  assert(single.prompt === PROMPTS[1] && single.jobId === jobIds[1], "single pending prompt carries its jobId")

  const empty = sp.run(`matchSentPromptForImage("", "")`)
  assert(empty.source === "empty" && empty.prompt === "", "nothing pending → empty")
}

// ── 3) jobId not in the pool: ledger fallback, no stale pool entry ──
{
  const sp = createSidepanel()
  const fast = sp.run(`ledgerCreate(${JSON.stringify(PROMPTS[0])}, "fox_girl")`)
  const other = sp.run(`ledgerCreate(${JSON.stringify(PROMPTS[1])})`)
  sp.run(`recordSentPrompt({ prompt: ${JSON.stringify(PROMPTS[1])}, jobId: ${JSON.stringify(other)} })`)

  // The image finishes before processNext records the prompt.
  const early = sp.run(`matchSentPromptForImage("", ${JSON.stringify(fast)})`)
  assert(early.source === "job-id-ledger" && early.prompt === PROMPTS[0], "early image resolves its prompt from the ledger")
  assert(early.character === "fox_girl", "ledger fallback keeps the character")
  sp.run(`recordSentPrompt({ prompt: ${JSON.stringify(PROMPTS[0])}, jobId: ${JSON.stringify(fast)} })`)
  assert(sp.run("sentPromptsQueue.length") === 1, "late pool entry of an already-paired job is dropped")
  const next = sp.run(`matchSentPromptForImage("", "")`)
  assert(next.jobId === other, "the remaining pending prompt is not shadowed by the stale one")

  // A task with two images reports the same jobId twice.
  const multi = sp.run(`ledgerCreate(${JSON.stringify(PROMPTS[2])})`)
  sp.run(`recordSentPrompt({ prompt: ${JSON.stringify(PROMPTS[2])}, jobId: ${JSON.stringify(multi)} })`)
  const a = sp.run(`matchSentPromptForImage("", ${JSON.stringify(multi)})`)
  const b = sp.run(`matchSentPromptForImage("", ${JSON.stringify(multi)})`)
  assert(a.prompt === PROMPTS[2] && b.prompt === PROMPTS[2], "both images of one task get that task's prompt")

  // Re-sending a job (retry of a lost job) starts a new attempt.
  sp.run(`armAutoDLJob(1, ${JSON.stringify(fast)})`)
  sp.run(`recordSentPrompt({ prompt: ${JSON.stringify(PROMPTS[0])}, jobId: ${JSON.stringify(fast)} })`)
  assert(sp.run("sentPromptsQueue.length") === 1, "re-armed job is recorded in the pool again")
  const armCall = sp.pageCalls.find((c) => c.func === "armAutoDLJobInPage")
  assert(!!armCall && armCall.args[0] === fast, "armAutoDLJob injects the arm helper with the jobId")

  sp.ctx.autoDownloadEnabled = false
  const callsBefore = sp.pageCalls.length
  sp.run(`armAutoDLJob(1, ${JSON.stringify(other)})`)
  assert(sp.pageCalls.length === callsBefore, "nothing is injected while auto-download is off")
}

// ── 4) Card prompt text still matches by content ──
{
  const sp = createSidepanel()
  const ids: string[] = [PROMPTS[1], PROMPTS[3]].map((p) => sp.run(`ledgerCreate(${JSON.stringify(p)})`))
  sp.run(`recordSentPrompt({ prompt: ${JSON.stringify(PROMPTS[1])}, jobId: ${JSON.stringify(ids[0])} })`)
  sp.run(`recordSentPrompt({ prompt: ${JSON.stringify(PROMPTS[3])}, jobId: ${JSON.stringify(ids[1])} })`)
  const match = sp.run(`matchSentPromptForImage("safe, 1boy, solo, knight, red_armor", "")`)
  assert(match.source === "matched" && match.jobId === ids[1], "truncated card text picks the matching prompt, not the oldest")
}

// ── 1b) Message listener end to end: the embedded prompt follows the jobId ──
async function runListenerTest() {
  const sp = createSidepanel()
  const embedded: Array<{ src: string; prompt: string; jobId: string }> = []
  sp.ctx.__embed = (src: string, prompt: string, jobId: string) => embedded.push({ src, prompt, jobId })
  sp.run(`triggerAutoDownload = async (tabId, src, prompt, character, jobId) => { __embed(src, prompt, jobId); return { success: true, downloadId: 1 } }`)
  const ids: string[] = PROMPTS.slice(0, 3).map((p) => sp.run(`ledgerCreate(${JSON.stringify(p)})`))
  ids.forEach((id, i) => sp.run(`recordSentPrompt({ prompt: ${JSON.stringify(PROMPTS[i])}, jobId: ${JSON.stringify(id)} })`))
  const onMessage = sp.getOnMessage()
  const sender = { tab: { id: 7, url: "https://www.seaart.ai/workFlowDetail" } }
  for (const i of [2, 0, 1]) {
    onMessage({ type: "AUTODL_NEW_IMAGE", src: `https://image.cdn2.seaart.me/task-${i}.png`, prompt: "", jobId: ids[i] }, sender)
  }
  await new Promise((r) => setTimeout(r, 0))
  for (const i of [0, 1, 2]) {
    const saved = embedded.find((e) => e.src.endsWith(`task-${i}.png`))
    assert(!!saved && saved.prompt === PROMPTS[i], `listener embeds job ${i + 1}'s prompt into its image`)
  }
  assert(ids.every((id) => sp.run(`ledgerGet(${JSON.stringify(id)}).state`) === "completed"), "each job is marked completed once its own image is saved")
}

// ─────────────────────────────────────────────────────────────────────────────
// Page context: minimal DOM shaped like SeaArt's ComfyUI history list
// ─────────────────────────────────────────────────────────────────────────────

type Compound = { tag?: string; classes: string[] }

function parseCompound(s: string): Compound {
  const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)$/.exec(s)
  if (!m) throw new Error(`fake DOM: unsupported selector "${s}"`)
  return { tag: m[1]?.toLowerCase(), classes: m[2] ? m[2].slice(1).split(".") : [] }
}

class FakeElement {
  nodeType = 1
  tagName: string
  classes: Set<string>
  attrs = new Map<string, string>()
  children: FakeElement[] = []
  parentNode: FakeElement | null = null
  shadowRoot = null
  textContent = ""
  src = ""
  currentSrc = ""
  naturalWidth = 0
  complete = false
  loading = ""
  listeners = new Map<string, Array<() => void>>()

  constructor(public doc: FakeDocument, tag: string, className = "") {
    this.tagName = tag.toLowerCase()
    this.classes = new Set(className.split(/\s+/).filter(Boolean))
  }

  private matchesCompound(c: Compound) {
    return (!c.tag || c.tag === this.tagName) && c.classes.every((k) => this.classes.has(k))
  }

  matches(selector: string): boolean {
    return selector.split(",").some((complex) => {
      const parts = complex.trim().split(/\s+/).map(parseCompound)
      if (!this.matchesCompound(parts[parts.length - 1])) return false
      let node = this.parentNode
      for (let i = parts.length - 2; i >= 0; i--) {
        while (node && !node.matchesCompound(parts[i])) node = node.parentNode
        if (!node) return false
        node = node.parentNode
      }
      return true
    })
  }

  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = []
    const walk = (el: FakeElement) => {
      for (const child of el.children) {
        if (child.matches(selector)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] || null
  }

  getAttribute(name: string) {
    if (name === "src") return this.src || null
    return this.attrs.has(name) ? this.attrs.get(name)! : null
  }

  setAttribute(name: string, value: string) {
    this.attrs.set(name, String(value))
  }

  hasAttribute(name: string) {
    return this.attrs.has(name)
  }

  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), fn])
  }

  dispatch(type: string) {
    const fns = this.listeners.get(type) || []
    this.listeners.delete(type)
    fns.forEach((fn) => fn())
  }

  appendChild(child: FakeElement) {
    child.parentNode = this
    this.children.push(child)
    this.doc.notify(this, child)
    return child
  }

  prepend(child: FakeElement) {
    child.parentNode = this
    this.children.unshift(child)
    this.doc.notify(this, child)
  }
}

class FakeDocument {
  observers: Array<{ enqueue: (record: unknown) => void }> = []
  body: FakeElement

  constructor() {
    this.body = new FakeElement(this, "body")
  }

  get children() {
    return [this.body]
  }

  querySelectorAll(selector: string) {
    return this.body.querySelectorAll(selector)
  }

  addEventListener() {}

  notify(target: FakeElement, added: FakeElement) {
    let node: FakeElement | null = target
    while (node && node !== this.body) node = node.parentNode
    if (!node) return // not attached yet
    for (const o of this.observers) o.enqueue({ type: "childList", target, addedNodes: [added] })
  }
}

const AVATAR = "https://static.cdn.seaart.me/avatar.png"

function createPage({ withHistory = true } = {}) {
  const doc = new FakeDocument()
  const reports: Array<{ src: string; prompt: string; jobId: string }> = []
  const intervals: Array<() => void> = []
  const ctx: any = {
    console: quiet,
    document: doc,
    chrome: { runtime: { sendMessage: (msg: any) => reports.push(msg) } },
    // The observer's 1.5s scan; tests run it by hand through scan().
    setInterval: (fn: () => void) => intervals.push(fn),
    clearInterval() {},
    MutationObserver: class {
      private queue: unknown[] = []
      constructor(private cb: (records: unknown[]) => void) {}
      observe() {
        doc.observers.push(this)
      }
      disconnect() {
        doc.observers = doc.observers.filter((o) => o !== this)
      }
      enqueue(record: unknown) {
        if (this.queue.push(record) > 1) return
        queueMicrotask(() => {
          const records = this.queue
          this.queue = []
          this.cb(records)
        })
      }
    },
  }
  ctx.window = ctx
  vm.createContext(ctx)

  const list = new FakeElement(doc, "div", "history-content")
  doc.body.appendChild(list)

  const sp = createSidepanel()
  const inject = (fnName: string, args: unknown[]) => {
    const source = sp.run(`${fnName}.toString()`)
    return vm.runInContext(`(${source})(...${JSON.stringify(args)})`, ctx)
  }
  const ttl = sp.run("AUTODL_ARM_TTL_MS")

  const newCard = () => {
    const card = new FakeElement(doc, "div", "c-workflow-history-item")
    const header = new FakeElement(doc, "div", "workflow-history-item-header")
    const avatar = new FakeElement(doc, "img", "workflow-history-item__avatar")
    avatar.src = avatar.currentSrc = AVATAR
    avatar.naturalWidth = 64
    avatar.complete = true
    header.appendChild(avatar)
    card.appendChild(header)
    return card
  }
  // SeaArt renders the image container once the task runs, then the image.
  const finishTask = (card: FakeElement, src: string, { loaded = true } = {}) => {
    const container = new FakeElement(doc, "div", "workflow-history-image-container")
    const box = new FakeElement(doc, "div", "c-history-box c-history-box-img")
    const wrap = new FakeElement(doc, "div", "c-history-img")
    const img = new FakeElement(doc, "img", "media-attachments-img")
    img.loading = "lazy"
    img.src = img.currentSrc = src
    if (loaded) {
      img.naturalWidth = 1024
      img.complete = true
    }
    wrap.appendChild(img)
    box.appendChild(wrap)
    container.appendChild(box)
    card.appendChild(container)
    return img
  }

  // Two finished tasks from before the batch.
  if (withHistory) {
    for (const n of [1, 2]) {
      const card = newCard()
      list.appendChild(card)
      finishTask(card, `https://image.cdn2.seaart.me/old-${n}.png`)
    }
  }

  return {
    list,
    reports,
    newCard,
    finishTask,
    install: () => inject("installAutoDownloadObserverInPage", [ttl]),
    arm: (jobId: string) => inject("armAutoDLJobInPage", [jobId, ttl]),
    disarm: (jobId: string) => inject("disarmAutoDLJobInPage", [jobId]),
    scan: () => intervals.forEach((fn) => fn()),
    flush: () => new Promise((r) => setTimeout(r, 0)),
    reportFor: (src: string) => reports.find((r) => r.src === src),
  }
}

async function runPageTests() {
  // ── 5a) Cards created after an arm carry the job; completion order is free ──
  {
    const page = createPage()
    page.install()
    await page.flush()
    assert(page.reports.length === 0, "history from before the observer is not reported")

    const cards: FakeElement[] = []
    for (const job of ["job_a", "job_b", "job_c"]) {
      page.arm(job)
      const card = page.newCard() // SeaArt inserts the card after the click
      page.list.prepend(card)
      cards.push(card)
      await page.flush()
    }
    assert(cards.map((c) => c.getAttribute("data-booru-job-id")).join() === "job_a,job_b,job_c", "each new card is tagged with the job armed before it")

    page.finishTask(cards[2], "https://image.cdn2.seaart.me/c.png")
    page.finishTask(cards[0], "https://image.cdn2.seaart.me/a.png")
    const lazy = page.finishTask(cards[1], "https://image.cdn2.seaart.me/b.png", { loaded: false })
    await page.flush()
    lazy.naturalWidth = 1024
    lazy.complete = true
    lazy.dispatch("load")

    assert(page.reportFor("https://image.cdn2.seaart.me/a.png")?.jobId === "job_a", "image finished second still reports job_a")
    assert(page.reportFor("https://image.cdn2.seaart.me/b.png")?.jobId === "job_b", "lazily loaded image reports job_b")
    assert(page.reportFor("https://image.cdn2.seaart.me/c.png")?.jobId === "job_c", "image finished first reports job_c")
    assert(!page.reports.some((r) => r.src === AVATAR), "card avatars are never reported as images")
  }

  // ── 5b) Clicks that created no task, reloads, scrolling, manual runs ──
  {
    const page = createPage()
    page.install()
    await page.flush()

    // Task-limit modal: armed, then disarmed, no card. The next job is clean.
    page.arm("job_blocked")
    page.disarm("job_blocked")
    page.arm("job_next")
    const next = page.newCard()
    page.list.prepend(next)
    await page.flush()
    assert(next.getAttribute("data-booru-job-id") === "job_next", "a disarmed click does not shift the next tag")

    // List reload while armed: several cards at once, none tagged, arm kept.
    page.arm("job_after_reload")
    const reloaded = [page.newCard(), page.newCard()]
    const wrapper = new FakeElement(page.list.doc, "div", "history-page")
    reloaded.forEach((c) => wrapper.appendChild(c))
    page.list.appendChild(wrapper)
    await page.flush()
    assert(reloaded.every((c) => !c.hasAttribute("data-booru-job-id")), "cards from a list reload are not tagged")

    // Older card loaded by scrolling: appended at the bottom, not tagged.
    const older = page.newCard()
    page.list.appendChild(older)
    await page.flush()
    assert(!older.hasAttribute("data-booru-job-id"), "a card appended at the bottom is not tagged")

    const real = page.newCard()
    page.list.prepend(real)
    await page.flush()
    assert(real.getAttribute("data-booru-job-id") === "job_after_reload", "the armed job still tags its own card afterwards")

    // A generation the user starts by hand, with nothing armed.
    const manual = page.newCard()
    page.list.prepend(manual)
    await page.flush()
    assert(!manual.hasAttribute("data-booru-job-id"), "a card nobody armed for stays untagged")
    page.finishTask(manual, "https://image.cdn2.seaart.me/manual.png")
    await page.flush()
    assert(page.reportFor("https://image.cdn2.seaart.me/manual.png")?.jobId === "", "its image reports no job")
  }

  // ── 5c) A card that could belong to two jobs is left untagged ──
  {
    const page = createPage()
    page.install()
    await page.flush()

    page.arm("job_slow") // its card never shows up before the next click
    page.arm("job_fast")
    const ambiguous = page.newCard()
    page.list.prepend(ambiguous)
    await page.flush()
    assert(!ambiguous.hasAttribute("data-booru-job-id"), "card after a missing one is not guessed")
    const second = page.newCard()
    page.list.prepend(second)
    await page.flush()
    assert(!second.hasAttribute("data-booru-job-id"), "the other card of the pair is not guessed either")

    page.arm("job_clean")
    const clean = page.newCard()
    page.list.prepend(clean)
    await page.flush()
    assert(clean.getAttribute("data-booru-job-id") === "job_clean", "tagging resumes with the next job")
  }

  // ── 5d) The periodic scan: avatars are not images, missed cards get tagged ──
  {
    const page = createPage({ withHistory: false }) // no old avatar to seed as seen
    page.install()
    page.arm("job_first")
    const card = page.newCard()
    // Inserted without a MutationObserver record (e.g. inside a shadow root).
    card.parentNode = page.list
    page.list.children.unshift(card)
    page.scan()
    assert(card.getAttribute("data-booru-job-id") === "job_first", "the scan tags a card the observer did not see")
    assert(!page.reports.some((r) => r.src === AVATAR), "the scan does not report the card avatar as an image")
  }
}

async function main() {
  await runListenerTest()
  await runPageTests()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
