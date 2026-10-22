# Backlog

These are real issues that the audit loop judged below its bar. Each one is LOW: below MEDIUM under the owner's rules. Some are accessibility issues judged off the common path. They were deliberately left unfixed so the loop could converge.

Each entry says what the issue is, where it is, why it's low, and a suggested fix. The first part lists defects. The second lists refactors from the round 11 cleanup review: each is worth doing the next time its code needs a fix, rather than patching that code again.

## Defects

- **Error line is off after comments, directives or front matter.**
  - **What:** Pele strips `%%` comment lines, `%%{…}%%` directives, front matter and leading blank lines before parsing, then reports lines in that stripped text. So an error below them is reported a line or more too early.
  - **Where:** `packages/core/src/render.ts`, `validate`.
  - **Why low:** the error is still shown, and on the right line when there are no comments above it.
  - **Fix:** in Pele, report positions in the original text. Round 11 tried mapping it back in Eos by copying Pele 1.6.0's preprocessing (~110 lines). That was turned down as too coupled to Pele's internals for a low issue.

- **Error snippet clipped on long lines.**
  - **What:** under the source, the error snippet `<pre>` is cut off at the pane's edge and can't be scrolled. For an error past about column 50 (column 86, say), the `^` caret can't be seen.
  - **Where:** `apps/web/src/components/editor.tsx`, the snippet `<pre>`.
  - **Why low:** the footer still gives "Line N, column M", and the line is highlighted in the editor.
  - **Fix:** add `overflow-x-auto`, plus `tabIndex={0}` and an `aria-label`, so the scrollable region can be reached from the keyboard (axe's `scrollable-region-focusable`).

- **Version history and the version banner leave out the year.**
  - **What:** a version from last year reads "Sep 15, 11:23 PM", the same as one from this year.
  - **Where:** `apps/web/src/components/history-menu.tsx`, `formatWhen`.
  - **Why low:** only versions over a year old are affected, and the list is still in order.
  - **Fix:** add `year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric"`, as `grouping.ts` does.

- **The "Couldn't render" pill blocks preview gestures over it.**
  - **What:** a pinch (Ctrl+wheel) over the pill zooms the page, and a drag that starts on it doesn't pan. On a phone the pill wraps to two lines.
  - **Where:** `apps/web/src/components/editor.tsx`, the pill's div.
  - **Why low:** the rest of the pane works, and the pill only shows while the source is invalid.
  - **Fix:** add `pointer-events-none` to the pill.

- **`updateSettings`'s type hides that it merges.**
  - **What:** `Eos.updateSettings(patch: Partial<AppSettings>)` merges `theme` and `agent` field by field, but its type asks for whole objects.
  - **Where:** `packages/core/src/store.ts` (`updateSettings`). Callers: `set_theme` in `packages/webmcp/src/index.ts`, which casts `as never`; Settings' Save, which spreads the rendered theme in first; and `importBackup`, which spreads `settingsCache.theme` in first.
  - **Why low:** behaviour is correct, and every caller works around the type.
  - **Fix:** type the parameter `{ theme?: Partial<AppSettings["theme"]>; agent?: Partial<AppSettings["agent"]> }`, then drop the cast and the two spreads.

- **Settings › MCP: the chrome:// addresses break at their own hyphens on phones.**
  - **What:** at 320 to 390px, the addresses break as `#enable-` ⏎ `webmcp-testing` and `#remote-` ⏎ `debugging`. That contradicts the comment "Wrap only after a / or #".
  - **Where:** `apps/web/src/components/settings-dialog.tsx`, `ChromeUrl`.
  - **Why low:** cosmetic, and the copy button gives the exact address.
  - **Fix:** wrap each part in `<span className="whitespace-nowrap">`, keep the `<wbr />` between parts, and drop `[overflow-wrap:anywhere]` if it's no longer needed.

- **Diagrams already saved with CRLF line endings.**
  - **What:** round 11 normalises line endings when a source enters core, and the editor breaks lines only at `\n`, so what it shows and what's stored stay in step. Text inserted by script (`document.execCommand("insertText")`, a route some extensions and IMEs use) skips the paste filter, so in Firefox and WebKit a `\r\n` that comes in that way is stored with its `\r`; the editor and the store still agree, and what follows is the same as below. A diagram an agent wrote with `\r\n` before that fix still holds its `\r`s, and so does one brought back from a backup or an old version. Each `\r` shows as a ␍ marker at the end of its line until it's edited away. End puts the caret after the marker, so text typed there leaves a lone `\r` mid-line. Pele counts that as a line break and the editor doesn't, so the preview splits the line there, and an error on any later line is reported and highlighted one line too low.
  - **Where:** `packages/core/src/store.ts` (opening a diagram).
  - **Why low:** only diagrams saved with CRLF before round 11 are affected, and most likely none exist.
  - **Fix:** if one turns up, normalise the text once when the diagram opens, as a system change.

- **Core tests don't cover two parts of setStarred.**
  - **What:** removing setStarred's `this.emit("library", …)` leaves this tab's cached rows stale (listDiagrams and counts still show 0 stars after a star), and all 111 core tests still pass. Only e2e `tags.spec.ts` (drag onto Starred) catches it. Removing the missing-id check passes both the core and webmcp suites, and `setStarred("nope", true)` then stops rejecting.
  - **Where:** `packages/core/src/store.ts` (`setStarred`), `packages/core/src/store.test.ts`.
  - **Why low:** the code is correct today, and an e2e test catches the larger of the two.
  - **Fix:** add two core tests. First, star in one tab, then check listDiagrams, counts and the `diagram:<id>` event in the same tab. Second, check that `setStarred` rejects a missing id.

- **The confirm's abort guard isn't tested.**
  - **What:** the abort guard `state.confirm?.id === entry.id` can be removed and the confirm tests still pass. Separately, `answerConfirm`'s comment gives a reason for closing before resolving that has no effect: promise callbacks run in a later microtask anyway.
  - **Where:** `apps/web/src/lib/ui-state.ts` (`askConfirm`, `answerConfirm`), `e2e/confirm.spec.ts`.
  - **Why low:** behaviour is correct in every case checked. The guard is defensive.
  - **Fix:** add a test where an agent aborts after the person has answered and a second confirm is open (the second must stay open). Then trim `answerConfirm`'s comment to what the order actually does.

- **On touch tablets in the desktop layout, the left 4px of Show sidebar don't respond.**
  - **What:** with the sidebar collapsed on a coarse pointer (iPad Pro 11 landscape, 1194×834), a tap at x=8 on Show sidebar (x=6 to 34) does nothing. Taps at x=11 and further right work. react-resizable-panels widens a 0px separator's hit area to ±10px on coarse pointers.
  - **Where:** `apps/web/src/components/page.tsx` (the header that holds `SidebarToggle`).
  - **Why low:** it's only a sliver of a 28px button, and only on touch tablets wide enough for the desktop layout.
  - **Fix:** give the header more left padding on coarse pointers (e.g. `pointer-coarse:pl-3`), so the button starts past x=10.

- **On iPhone, a tag's Delete tag can't be reached.**
  - **What:** a tag row's menu opens only on `contextmenu` or from the keyboard. iOS Safari fires no `contextmenu` on a long press: the row lifts as a native drag instead. So on an iPhone, Delete tag can't be reached.
    - Change icon is still on the row's `#` button.
    - Move to top level still works by dragging onto the "Move to top level" zone (checked in the iOS 27 Simulator).
  - **Where:** `apps/web/src/components/tag-tree.tsx`, the TreeItem's `onContextMenu`.
  - **Why low:** the same result is reachable: select the tag's cards (long-press one, tap the rest) and uncheck the tag in Tags. It's also an occasional action.
  - **Fix:** the card's `useLongPress` doesn't carry over. In the simulator it opened the menu at about 450 ms, then iOS's drag lift at about 650 ms dismissed it, and turning the drag off would lose touch tag drag. What did work in the simulator: hold, then let go without moving, opens the menu, and hold and move still drags. Moving produces `pointercancel`, so no `pointerup` arrives. Use capture handlers, because React Aria's row handlers swallow the bubbling `onPointerUp`, and `onDragStart` isn't passed through:
    ```tsx
    const held = useRef<{ x: number; y: number; t: number } | null>(null)
    // on the TreeItem, only when coarsePointer:
    onPointerDownCapture={(e) => (held.current = e.pointerType === "touch" ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null)}
    onPointerUpCapture={(e) => {
      const h = held.current
      held.current = null
      if (!h || e.timeStamp - h.t < 500 || Math.hypot(e.clientX - h.x, e.clientY - h.y) > 10) return
      if ((e.target as Element).closest("button")) return // the icon and chevron buttons keep their own press
      const row = e.currentTarget as HTMLElement
      const r = row.getBoundingClientRect()
      setMenu({ tag: tag.path, x: r.left, y: r.bottom, from: row })
    }}
    ```
    Check it on Android, where a long press also fires `contextmenu`. Test it in WebKit with iPhone emulation: dispatch a touch `pointerdown`, wait 600 ms, dispatch `pointerup` at the same point, and expect "Delete tag".

- **A tab that starts while another tab stars a diagram misses the star until it reloads.**
  - **What:** `Eos.create` loads the workspace, then awaits the settings read, and only then calls `listenToOtherTabs`. A workspace update another tab saves and broadcasts in that gap is never heard, and the workspace isn't read from disk again. Since round 11, rows don't carry the star, so `recheckRows` can't correct it.
    - The tab's counts, its library and the Star button show no star, and a backup exported from it leaves the star out.
    - Tag emoji had the same window before round 11.
  - **Where:** `packages/core/src/store.ts`, `Eos.create` (lines 140-146) and `recheckRows`.
  - **Why low:** it needs a star or emoji change to land within a few milliseconds of another tab starting up. It was only reproduced by holding the settings read open (0 of 20 natural interleavings). Disk is right, and a reload fixes it.
  - **Fix:** open the channel before `loadDoc(db, WORKSPACE_ID)` and hold workspace messages until the doc exists. Or, more simply, re-import the workspace from disk in `recheckRows`. Repro: hold the new tab's settings read until the other tab has starred, then check the new tab's library.

- **The editor's shortcuts still act behind Settings or a confirm.**
  - **What:** on a diagram page with Settings or a confirm open:
    - ⌘= and ⌘− zoom the hidden preview, and block the browser's page zoom for the dialog.
    - ⌘⇧L and ⌘⇧C overwrite the clipboard with a share link or the SVG.
    - ⇧0 and ⇧1 fit or reset the hidden zoom.
  - **Where:** `apps/web/src/components/editor.tsx`, `useShortcuts` (a window `keydown` with no modal check).
  - **Why low:** nothing is lost. The changes are hidden and reversible, and page zoom is still in the browser menu.
  - **Fix:** in `onKey`, return early when `getUi().settingsOpen || getUi().confirm?.open`, or when `e.target` is inside a `dialog`.

- **An agent's replace import asks more mildly than delete_all_data, though it destroys as much.**
  - **What:** `import_backup {mode: "replace"}` asks "The agent wants to replace all your diagrams with a backup." It wipes everything first (Deleted, stars and tag emoji too), and the backup can be empty (`{"v":1,"diagrams":[]}`). delete_all_data's confirm adds "This can't be undone."; this one doesn't, and it doesn't say what the backup holds.
  - **Where:** `packages/webmcp/src/index.ts`, `import_backup`.
  - **Why low:** the text is accurate, a person must click Replace, and only agents (Chrome WebMCP) can replace.
  - **Fix:** compute `const c = await eos.counts()` once, then ask `` `The agent wants to replace all ${c.all + c.deleted} of your diagrams with a backup of ${backup.diagrams.length}. This can’t be undone.` ``

- **Dropping a dragged card on Search fills it with the card's URL.**
  - **What:** a card drag carries `text/plain` (its link), so releasing it over the library's Search box types the URL into the search.
  - **Where:** `apps/web/src/components/home.tsx`, the Search input.
  - **Why low:** an accidental drop target; the cost is clearing the box.
  - **Fix:** on the input, `onDragOver`/`onDrop` that `preventDefault()` when `e.dataTransfer.types.includes(DIAGRAM_MIME)`.

- **A core test asserts after a fixed 50 ms wait for another tab.**
  - **What:** store.test.ts "hears every keystroke in a tab that opens the diagram while another tab's typing is being saved" checks after `settle()` (50 ms). Under heavy machine load (load average 57+) it failed 8/12 with 3 parallel processes. Its siblings that wait on another tab ("merges two tabs typing…", "reads the rows once…") have the same pattern.
  - **Where:** `packages/core/src/store.test.ts` (about line 1104, with `settle` at line 1102) and the other `settle()` checks in that describe.
  - **Why low:** it passed in every CI run, in `turbo test`, and with 3 parallel processes at normal load. The product converges within milliseconds.
  - **Fix:** replace the last `await settle(); expect(...)` with `await expect.poll(() => two.getSource(id), { timeout: 5000 }).toBe(a.state.text)`. This was verified to still catch the bug it guards (onLocalUpdate before the write finishes).

- **After a click on the preview, a Chromium text commit still lands in the source.**
  - **What:**
    1. Select or place the caret in the source.
    2. Click the preview. Focus goes to the page body, and the selection stays in the source.
    3. Commit text in Chrome without a keystroke: the emoji picker or dictation (reproduced with CDP `Input.insertText`).

    The text is inserted at the old selection. Chrome fires no `beforeinput` for it: it focuses the editor itself (`input`, then `focusin`) and inserts, so the editor's "no input without focus" guard never sees an event it could cancel.

  - **Where:** `apps/web/src/components/code-editor.tsx` (the unfocused-input guard), `apps/web/src/components/preview.tsx` (`onPointerDown`).
  - **Why low:**
    - It's Chromium only, and only after a preview click.
    - It needs a commit that isn't a keystroke; typed keys, ⌘V and ⌘X are refused.
    - The editor ends up focused with the text visible, and ⌘Z removes it.
    - Round 15 deliberately dropped the `removeAllRanges()` that hid this, because it broke ⌘C after a preview click.
  - **Fix:** none cheap. Focusing the preview frame on click, instead of blurring to the body, would give Chrome a focused target, so the guard would see a `beforeinput`. Check the preview's page-level shortcuts first.

- **The emoji picker's search takes focus on touch, raising the iPhone keyboard.**
  - **What:** choosing Change icon on a tag opens the picker with its search box focused. On a phone, the keyboard then covers most of the picker.
  - **Where:** `apps/web/src/components/tag-emoji-picker.tsx` (`<Input autoFocus …>`).
  - **Why low:** the picker still works; the keyboard can be dismissed or scrolled past.
  - **Fix:** do as `tag-menu.tsx` does: `onOpenAutoFocus={(e) => matchMedia("(pointer: coarse)").matches && e.preventDefault()}` on the popover, and drop `autoFocus`, or focus it only on a fine pointer.

- **At 320px the Tags popover sits flush against the right edge of the screen.**
  - **Where:** `apps/web/src/components/tag-menu.tsx` (PopoverContent).
  - **Why low:** cosmetic; everything fits and works.
  - **Fix:** give the popover a collision padding (e.g. `collisionPadding={8}`).

- **Two tabs typing in one diagram can leave its library row stale until the next edit.**
  - **What:** a tab writes the row from its own doc when its typing pauses (300 ms). If the other tab's last keystroke hasn't reached it by then, the row lacks that keystroke. The receiving tab rebuilds rows only for meta changes, so the card preview and search text lag the doc until the next edit.
  - **Where:** `packages/core/src/store.ts`, the channel's `"update"` handler and `refreshIndexSoon`.
  - **Why low:** only when one tab's write plus broadcast takes over 300 ms. The doc itself is right, and any later edit corrects the row.
  - **Fix:** in the `"update"` handler, also call `refreshIndexSoon(id, d)` when a source change arrives for an open diagram. Repro: in a core test with two tabs on one diagram, delay one tab's index write by 400 ms while both type, then check the other tab's row against its doc.

- **An open that fails in the cross-tab update branch is an uncaught rejection.**
  - **What:** the channel's `"update"` branch does `await this.openDiagram(data.id)` with no catch. If that open fails ("not found", e.g. during a purge or a replace import in another tab), it surfaces as an uncaught exception.
  - **Where:** `packages/core/src/store.ts`, the `"update"` handler (about line 1000).
  - **Why low:** console noise only; nothing is lost.
  - **Fix:** `.catch(() => {})` on that open, with a comment that the diagram went away underneath.

- **In Settings, Escape doesn't collapse a CSS editor's selection.**
  - **What:** inside a dialog, the Escape keymap entry handles the key, so it stops there and the dialog stays open. CodeMirror's own Escape (`simplifySelection`) then never runs. The selection stays, in all three engines.
  - **Where:** `apps/web/src/components/code-editor.tsx`, the Escape keymap entry.
  - **Why low:** cosmetic. Escape then Tab still leaves the editor, and Settings stays open. Round 16 corrected the comment that claimed it collapses.
  - **Fix:** call `simplifySelection(v)` (from `@codemirror/commands`) in that entry when it's in a dialog. Add an e2e: select text in the Diagram theme CSS editor, press Escape, and expect the selection to be empty and the dialog open.

- **Firefox's `Intl.Segmenter` marks a run of Han, Kana or Thai that is one word as not word-like (browser bug).**
  - **What:** `segment` keeps every piece holding a letter or digit instead of filtering on `isWordLike`, or Firefox would index `東京` as no words. `search.test.ts` covers it.
  - **Where:** `packages/core/src/search.ts`, `segment`.
  - **Fix:** once Firefox fixes it, filter on `isWordLike`.

- **A word inside a dictionary compound can't be found, and which words can differs by browser.**
  - **What:** Chromium and WebKit segment `東京タワーの夜景` as `東京タワー|の|夜景`, so "タワー" finds nothing ("東京" does, as a prefix). Firefox splits it as `東京|タワー|の|夜景`. The same title gives different results by browser.
  - **Where:** `packages/core/src/search.ts`, `segment`.
  - **Why low:** the whole compound and its first word are found, and the other words of a title usually are too.
  - **Fix:** if it matters, also index each Han/Kana segment's character bigrams. Measure the index cost first (see the next entry).

- **Building the search index is slow for large Chinese or Japanese libraries.**
  - **What:** `Intl.Segmenter` runs once per word in unspaced scripts. 1000 Chinese flowcharts of 2 KB take about 480 ms to index: about 48 ms per 100-row slice, where `BUILD_SLICE`'s comment says about 10 ms. English is 50 ms per 1000×300 words since round 16 skips normalising ASCII.
  - **Where:** `packages/core/src/search.ts`, `segment` and `BUILD_SLICE`.
  - **Why low:** it only matters with hundreds of long CJK diagrams. The build is sliced, so typing still gets turns.
  - **Fix:** cache `segment(run)` per index build, in a Map created in `searchIndex` and passed to a per-index tokenizer. With 8 repeated labels this gave 480 → 205 ms. Don't use a module-level Map: it would grow for the session.

- **Accent folding is too broad for Cyrillic and too narrow elsewhere.**
  - **What:**
    - **Too broad:** stripping U+0300–036F removes й's breve and ё's diaeresis, so "мои" finds "Мой план".
    - **Too narrow:** letters that NFD doesn't split (ø, ł, đ, æ), Arabic harakat, Hebrew niqqud and fullwidth forms aren't folded, and ß isn't treated as ss. So "lodz" doesn't find "Łódź", and "مخطط" doesn't find "مُخَطَّط".
    - **Not segmented:** `UNSPACED` leaves out Tibetan, Javanese and Balinese.
  - **Where:** `packages/core/src/search.ts`, the tokenizer's fold and `UNSPACED`.
  - **Why low:** the extra Cyrillic matches are near matches. The missed folds never matched before round 15 either.
  - **Fix:**
    - Re-compose й/Й and ё/Ё before stripping, or strip only from Latin, Greek and Vietnamese base letters.
    - Add an explicit map for ø ł đ æ → o l d ae, strip U+064B–065F and U+0591–05C7, and apply NFKC for fullwidth.
    - Add the three scripts to `UNSPACED`.
    - Keep the English equivalence test green.

- **A confirm focus-timing e2e test can fail under heavy parallel load.**
  - **What:** `e2e/confirm.spec.ts` "opened 50ms after the last confirm was answered, answered by Escape: focus goes back to the first one's opener" failed once in Firefox (1 of 1160 tests, 8 workers, all three engines at once). Run 5× on its own, it passed 110/110.
  - **Where:** `e2e/confirm.spec.ts`, the test named above.
  - **Why low:** test timing only. The product behaviour is unchanged.
  - **Fix:** if it recurs, wait for the first confirm to have closed (`toBeHidden`) instead of a fixed 50 ms before opening the second.

- **A heavy agent rewrite can drop what the person typed on the line it rewrites.**
  - **What:** in a `baseVersion` merge, when the agent deletes or rewrites the line the person has typed on since the base, the person's new characters can be lost (for example, base `x\n\t`, the person adds `#P#` after `x`, the agent rewrites the whole text). Both the jsdiff-based merge before round 16 and the Loro-based merge after it lose text in some of these cases, but in different ones. Round 16's fuzzing found the total number of clearly wrong merges went down. Since round 18 the merge diffs by lines, and since round 19 a line break belongs to the line it ends. So only what the person typed on a line the agent changes or removes (or moves, see below) can be lost, along with a whole line the person added between two lines the agent changes or removes: one character diff of changed lines can run across both (for example, base `graph TD\n  A --> B\n  C --> D\n`, the person adds a line above `C --> D`, and the agent sends `graph TD\n%%  C --> D`). Fixing that needs `diffText` to pair changed lines before diffing their characters. Since A1, HEAD keeps the typing in the core auditor's case, but strands it (`"a\nYb"`).
  - **Where:** `packages/core/src/store.ts`, `mergeFromBase` and `diffText`.
  - **Why low:** the agent's deletion overlaps the person's edit, so there is no clearly right answer. The text is still in history, and the person can undo.
  - **Fix:** if wanted, keep insertions the person made inside a range the agent deletes, and place them after the agent's replacement.

- **Retrying an update_diagram with the same baseVersion applies the edit twice.**
  - **What:** an agent calls `update_diagram {source, baseVersion: v}`, then repeats the call unchanged, for example after a lost response, or after cancelling the call (execute doesn't stop on abort). The second call merges the diff from `v` again, on top of the first result. With base `graph TD\n  A --> B` and an added `  B --> C`, sending it twice gives `B --> C` twice.
  - **Where:** `packages/core/src/store.ts`, `editDiagram` (the `mergeFromBase` call).
  - **Why low:** the second call returns the merged `source`, which shows the duplicate, and agent undo reverts it. It only happens when an agent reuses a base it has already applied.
  - **Fix:** skip the merge when `edit.source === sourceOf(d)`: the text already is the agent's text, so the call is a no-op. Add a webmcp test that sends the same call twice and expects one copy.

- **Korean IME composition flashes "No diagrams match." more often since round 16.**
  - **What:** Hangul words are now matched exactly, so a syllable still being composed (`다이어그래` on the way to `다이어그램`) finds nothing. The library flashes its empty state mid-syllable, then shows the right results once the syllable is complete. It flashed at some states before round 16 too.
  - **Where:** `apps/web/src/components/home.tsx` (the Search input), `packages/core/src/search.ts`.
  - **Why low:** it's a brief flash during composition, and the final result is correct.
  - **Fix:** don't search while `e.nativeEvent.isComposing`, keeping the last results until `compositionend`.

- **Sort: Title ignores Thai and Indic vowel signs and sorts numbers as text.**
  - **What:** a row's `titleKey` strips every `\p{M}`, which drops Thai and Indic vowel signs, and `localeCompare` on it compares digits as text, so "Item 10" comes before "Item 2". The tag tree's collator is numeric.
  - **Where:** `packages/core/src/store.ts`, `titleKey` (in the row builder) and the `sort === "title"` comparator in `listDiagrams`.
  - **Why low:** the order is still stable and near-alphabetical.
  - **Fix:** compare titles with one module-level `Intl.Collator(undefined, { numeric: true, sensitivity: "base" })`, as the tag tree does. `sensitivity: "base"` already ignores accents, so `titleKey` can then go (it's in the stored row and `types.ts`; webmcp strips it).

- **Below about 360px wide, a focused Settings "About" tab isn't scrolled into view (Chromium, Firefox).**
  - **What:** at 320×568, or at 400% zoom on desktop, Tab from Storage focuses About, but the phone tab row doesn't scroll. Only "(A" of its focus ring shows, under the row's fade mask. WebKit scrolls it into view.
  - **Where:** `apps/web/src/components/settings-dialog.tsx`, the phone tab row (`max-md:overflow-x-auto`, the hidden scrollbar and the mask).
  - **Why low:** the tab is partly visible, so it passes WCAG 2.4.11 (Minimum), and Enter opens About. At 390px the whole tab is visible.
  - **Fix:** `onFocus={(e) => e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}` on the tab buttons, or `scroll-padding-inline` on the row.

- **Mixed-script search: a CJK word's exactness is untested, and a short Latin word gets typo tolerance from the query's length.**
  - **What:**
    - Replacing the mixed-query branch with a single search at the old tolerance passes every search test. Results are OR'd, so only ranking changes.
    - The tolerance for the Latin part is worked out from the whole query, so "登录 api" makes "api" fuzzy (while "api" alone is exact), and "東京 a" matches every diagram.
  - **Where:** `packages/core/src/search.ts` (the mixed branch), `packages/core/src/search.test.ts`.
  - **Why low:** it only changes ranking or adds near matches. Every right result is still found.
  - **Fix:** compute the Latin part's tolerance from the Latin words alone. Add a test that a CJK word in a mixed query stays exact, and one that "登录 api" doesn't match "apx".

- **An agent that moves the person's line can drop what they typed on it.**
  - **What:** `diffText` diffs by lines, so a reordering must call one of the lines involved "removed and added". When that's the line the person typed on since `baseVersion`, their typing is lost. Without a base, their caret leaves the line. Example: base `graph TD\n  P52 --> C\n  G --> E` with the person typing at the end of `P52 --> C`, and the agent sending `graph TD\n  G --> E\n  P52 --> C`.
    - HEAD before round 18 did the same by character coincidence. In round 18's fuzzing the line diff kept the person's text in 34 such cases where HEAD lost it, and lost it in 26 where HEAD kept it.
    - The webmcp auditor's "an agent's undo of a moved line puts the person's typing on another line" is the same shape. Nothing is lost there.
  - **Where:** `packages/core/src/store.ts`, `diffText` and `mergeFromBase`.
  - **Why low:** which of two swapped lines "moved" is ambiguous. The text is in history, and agent undo reverts the move.
  - **Fix:** if wanted, in `mergeFromBase`, treat a removed line that comes back unchanged elsewhere (unique in both texts) as a move. Insert the line's current text, from its start through its line break as mapped now, instead of the agent's copy.

- **A person's edit that deletes the line break an agent's edit is anchored on can join the agent's line onto theirs.**
  - **What:** with `baseVersion`, the person replaces the last line by deleting from the line break before it (`"\nL341"` becomes `"\nL342 …"`), and the agent adds a line above that last line. The agent's `"L343\n"` is anchored after the deleted line break, so the result is `"…L342 …L343\n"`. The r17 `r17merge` fuzzer at GAP=1 gives 14 of 452 such cases. They're identical before and after round 18.
  - **Where:** `packages/core/src/store.ts`, `mergeFromBase` (a whole-line insertion after a deleted line break).
  - **Why low:** the person's edit removed the agent's anchor, so the two edits overlap. The editor rarely selects across the previous line break to retype a line, and nothing is lost.
  - **Fix:** when the line break before a whole-line insertion (one ending with `"\n"`) was deleted since the base, insert at the start of the line now at that spot.

- **Rewriting a very large source with an unrelated text freezes the tab.**
  - **What:** an agent replacing a 69 KB, 2,500-line diagram with a 2,200-line unrelated one spends about 46 s in Loro's character diff, on the main thread. That was the same before round 18. Round 18's line diff made deleting or reordering lines fast (3.3 s → 17 ms, 8.7 s → 62 ms). A rewrite that changes every line keeps one big changed hunk.
  - **Where:** `packages/core/src/store.ts`, `charDiff`.
  - **Why low:** only an agent's whole-text rewrite of an unusually large diagram triggers it. The edit is correct when it lands.
  - **Fix:** pass `{ timeoutMs: 500 }` to `text.update` in `charDiff`. Loro then throws "Update timeout", so catch it and return the hunk as one removal plus one insertion. That's a few lines, and only that hunk loses the character diff.

- **Settings gives no confirmation after Import backup or Delete all.**
  - **What:** a successful Import backup in Settings › Storage, or Delete all once its confirm is accepted, shows and announces nothing. Only the library behind the dialog changes.
  - **Where:** `apps/web/src/components/settings-dialog.tsx` (Storage).
  - **Why low:** the result is visible in the library, and errors are shown. WCAG 4.1.3 doesn't strictly apply, since no status message is shown.
  - **Fix:** a one-line status under the buttons ("Imported 12 diagrams." / "Deleted all diagrams.") in a `role="status"` region.

- **Dialog, drawer and menu animations ignore reduced motion.**
  - **What:** the dialog transitions (150 ms fades, the drawer's 200 ms slide) and the Radix plus tw-animate menu animations (fades, zoom-95) run under `prefers-reduced-motion: reduce`. The app's own sidebar and preview animations respect it.
  - **Where:** `packages/ui`: the dialog rules in `globals.css`, popover, dropdown.
  - **Why low:** they're short and small. This is WCAG 2.3.3, which is AAA.
  - **Fix:** add `motion-reduce:animate-none` to the menus and a `@media (prefers-reduced-motion: reduce)` rule that drops the dialog transitions (or one global rule zeroing both durations).

- **Destructive buttons have a faint focus ring.**
  - **What:** Delete all diagrams and the confirm's Delete show focus as `ring-destructive/20` plus a 1 px red border. It's visible, but fainter than other buttons' rings.
  - **Where:** `packages/ui/src/components/button.tsx` (the `destructive` variant), stock shadcn.
  - **Why low:** the indicator is visible, and the border meets non-text contrast.
  - **Fix:** use `focus-visible:ring-destructive/50`, or the shared `ring-ring`.

- **In WebKit, ⌥Tab stops twice on every tag row.**
  - **What:** since round 18 each tag row has a drag button ("Drag ‹tag›") as well as its Change icon button. In Safari, ⌥Tab (which reaches every control) stops on both for every row, so going through a long tag tree takes twice as many presses. Chromium and Firefox reach the row's buttons only with the arrow keys.
  - **Where:** `apps/web/src/components/tag-tree.tsx`, the row's drag `Button` and its Change icon button.
  - **Why low:** every stop is labelled and works, and plain Tab skips them in Safari's default mode. It's only extra presses.
  - **Fix:** give the row's inner buttons `tabIndex={-1}` outside React Aria's own focus management, so the row is the only Tab stop and → reaches its buttons. Check that VoiceOver's drag path still works.

- **update_diagram's description calls the source edit "a minimal diff".**
  - **What:** the tool description says the source is "applied as a minimal diff". Since round 18 it's a line diff: lines the agent keeps are left alone, lines it adds or removes go in or out whole, and only changed lines get a character diff. So it isn't minimal in the textbook sense.
  - **Where:** `packages/webmcp/src/index.ts`, `update_diagram`'s description (about line 333).
  - **Why low:** what an agent relies on still holds: only what differs changes, and the rest of the text (and what the person typed on it) is kept.
  - **Fix:** say "applied as a line-by-line diff, so unchanged lines are kept as they are".

- **Closing a tab loses a title that's still being typed.**
  - **What:** the title field commits on blur, Enter, unmount, `beforeunload`, `pagehide` and hidden. A reload keeps the typed title, except sometimes in WebKit at 0 ms (the `title.spec` cell is fixme there). Closing the tab loses it in all three engines, because a write started while the tab closes never lands.
  - **Where:** `apps/web/src/components/editor.tsx` (`TitleInput`), `e2e/title.spec.ts`.
  - **Why it's here:** fixing it means saving the title while it's typed, for example debounced, which changes when renames reach history and other tabs. That's new behaviour, for the owner to decide.

- **On a full disk, edits look saved but are lost on reload.**
  - **What:** when IndexedDB writes fail (QuotaExceededError), `persistDoc` logs to `console.error` and carries on. The editor and library show the edit, but a reload brings back the last saved text. Nothing tells the person.
  - **Where:** `packages/core/src/docs.ts`, `persistDoc`'s queue; `apps/web` has no save-failed UI.
  - **Why low:** it needs the origin's storage quota to be exhausted. Once space frees up, the next write saves the whole doc and fills the gap.
  - **Fix:** have `persistDoc` emit a save-failed or recovered event, which the store forwards. The web app shows a persistent pill ("Couldn't save. Free up space or export a backup.") until a write succeeds.

- **The tag menu's "Move to top level" drops focus to the page.**
  - **What:** after "Move to top level" on a nested tag, the row it was on is gone. Radix's `onCloseAutoFocus` targets the removed row, so focus lands on BODY.
  - **Where:** `apps/web/src/components/tag-menu.tsx` and `tag-tree.tsx`, the moved-row refocus.
  - **Why low:** it's a rarer action, and the moved row is visible. One Tab gets back into the tree.
  - **Fix:** in `onCloseAutoFocus`, `preventDefault()` and focus the moved row by its new key, which the existing ref callback already finds.

- **In-app Back/Forward: the scroll position is kept in sessionStorage, not navigation entry state.**
  - **What:** `useScrollRestoration` stores `eos-scroll:<entry key>` in sessionStorage. The Navigation API's `updateCurrentEntry({ state })` and `currentEntry.getState()` would hold the position with the entry itself.
  - **Where:** `apps/web/src/lib/scroll-restore.ts`.
  - **Why low:** keying storage by `currentEntry.key` is what the key is for, and it works in all three engines.
  - **Fix:** if wanted, store `{ scrollTop }` with `navigation.updateCurrentEntry`, throttled to scrollend, and read `getState()` on restore.

- **The tag menu and the icon picker have no accessible name.**
  - **What:** the `role="menu"` and the picker's popover are unnamed, because their trigger is an `aria-hidden` span. A screen reader announces "menu" with no tag.
  - **Where:** `apps/web/src/components/tag-menu.tsx`, `tag-emoji-picker.tsx`.
  - **Why low:** axe passes, and the focused item names its action.
  - **Fix:** `aria-label={`${tag} actions`}` on the menu content, and `aria-label="Icon for ${tag}"` on the picker.

- **`document.title` never changes per view.**
  - **What:** every route has the title "Eos", so history, tabs and screen readers don't say which diagram or filter is open.
  - **Where:** `apps/web/src/App.tsx` (route rendering).
  - **Why low:** the page heading and the URL say it.
  - **Fix:** set `document.title` from the route: "‹title› · Eos", "Starred · Eos", "#tag · Eos".

- **A right-click on a second tag while the tag menu is open shows the browser's menu.**
  - **What:** with one tag's menu open, right-clicking another tag row opens the native context menu, and the first menu stays open.
  - **Where:** `apps/web/src/components/tag-tree.tsx` (the `onContextMenu` and Radix `DropdownMenu` modal layer).
  - **Why low:** a second right-click works once the first menu is closed.
  - **Fix:** on `pointerdown` outside, let Radix close the menu, then handle the `contextmenu` on the row. Or make the menu `modal={false}`, so the row receives the event.

- **The past-version error line is hand-rolled where @codemirror/lint could own it.**
  - **What:** `errorLine` (a StateField plus a line decoration) and `focusLine` re-implement a single diagnostic.
  - **Where:** `apps/web/src/components/code-editor.tsx`.
  - **Why low:** it works. `lint` would change the look (an underlined range, a tooltip and a panel), which is a UX decision.
  - **Fix:** if wanted, `setDiagnostics` with one diagnostic from Pele's position, and `lintGutter()`.

- **An apply that throws is retried silently in the next microtask.**
  - **What:** `try { apply() } catch { queueMicrotask(apply) }` in the binding listener never fired in 705 e2e runs. It swallows real errors from the first attempt.
  - **Where:** `apps/web/src/components/code-editor.tsx` (about line 194).
  - **Why low:** dead in practice. A real error still surfaces from the retry.
  - **Fix:** call `apply()` directly, and keep the microtask only if a test proves CodeMirror's "mid-update" refusal can happen there.

- **The store's BroadcastChannel undefined guard is dead.**
  - **What:** every browser at the floor, and Node 26, has `BroadcastChannel`.
  - **Where:** `packages/core/src/store.ts`.
  - **Why low:** dead code only.
  - **Fix:** delete the guard. Delete the `peer--` loop guard in `mergeFromBase` too, since it can't trigger.

- **Two collaboration e2e tests depend on the 800 ms merge window.**
  - **What:** "redo in one tab reaches the other" and "typing after an undone deletion…" fail under heavy load.
  - **Where:** `e2e/collaboration.spec.ts`.
  - **Why low:** test timing only.
  - **Fix:** `expect.poll` the undo or redo until the expected text, instead of one press after a fixed wait.

- **No e2e test for closing a dialog from its backdrop.**
  - **What:** neither a click on the backdrop (closes) nor a drag that starts inside and ends on the backdrop (stays open) is tested.
  - **Where:** `e2e/settings.spec.ts`, `packages/ui/src/components/dialog.tsx` (`closeOnBackdrop`).
  - **Why low:** it was verified by hand in A1 on three engines.
  - **Fix:** add both cases to settings.spec.

- **set_view's previewVersion needs diagramId, though its description says "the open diagram".**
  - **What:** `set_view({ previewVersion })` without `diagramId` returns not_found, even with a diagram open.
  - **Where:** `packages/webmcp/src/index.ts`, `set_view` (about lines 445–447).
  - **Why low:** agent-only, and the error says what's missing.
  - **Fix:** default `id` to the open diagram's id from the route, or change the description to "of diagramId".

- **Settings' Save reverts an agent's set_theme made while Settings is open.**
  - **What:** the CSS editors are uncontrolled, remounted by key. An agent's `set_theme` changes `customCss` or `diagramCss` underneath, and the person's Save writes the editor's older text back.
  - **Also (A3):** the same happens across tabs. With Settings open in one tab, a theme saved in another tab is reverted when this tab's Settings is saved. The same fix covers it.
  - **Where:** `apps/web/src/components/settings-dialog.tsx`.
  - **Why low:** it needs an agent theming during an open Settings. The agent's change can be reapplied.
  - **Fix:** bump the editor key when `customCss` or `diagramCss` changes from outside, and only when it differs from the editor's text.

- **After Back to latest, the error highlight can sit on the wrong line.**
  - **What:** while a past version shows, the hidden live editor is given the past version's `errorAt`, and the error line is only sent again when it changes. After Back to latest, the live editor can highlight the past version's error line, not its own.
  - **Where:** `apps/web/src/components/editor.tsx`, the live `CodeEditor`'s `errorAt` (both editors get `errorLine`).
  - **Why low:** it only appears after viewing a past version whose error is on a different line. The footer's "Line N" is right, and the next edit corrects the highlight.
  - **Fix:** give the live editor the latest version's own error line, kept separately from the previewed one.

- **On phones, Back to latest and Restore may raise the keyboard over the preview.**
  - **What:** since A1, both focus the live source synchronously in the tap. It's contenteditable with no `inputmode`, so iOS probably raises the keyboard. Not verified on a device.
  - **Where:** `apps/web/src/components/editor.tsx` (Back to latest and Restore, `CodeEditorHandle.focus()`).
  - **Why low:** it isn't verified on a device, and the keyboard can be dismissed.
  - **Fix:** focus the source only on keyboard activation (`e.detail === 0`), or not at all on `(pointer: coarse)`.

- **With nothing selected, an invisible "Selection" toolbar reads "0 selected".**
  - **What:** since A1, the count's `role=status` sits outside the bar's inert part, so the accessibility tree exposes a hidden toolbar holding only "0 selected".
  - **Where:** `apps/web/src/components/selection-bar.tsx`.
  - **Why low:** it's announced only when the selection changes, and reads correctly. The hidden toolbar is noise for anyone browsing by landmarks or roles.
  - **Fix:** render the status text empty at 0. Or move the status out of the toolbar and make the whole toolbar `inert` at 0.

- **Tapping the current view in the phone drawer leaves the drawer open.**
  - **What:** the drawer closes only when the location changes, so choosing the view that's already showing does nothing visible.
  - **Where:** `apps/web/src/App.tsx` (the mobile drawer).
  - **Why low:** the drawer can still be closed, and the user is already where they asked to go.
  - **Fix:** close the drawer on any nav link activation. Or close it on the Navigation API's `navigate` event, which fires for same-URL navigations too.

- **In-app Back/Forward across pages drops focus to the page.**
  - **What:** Back or Forward between the library and a diagram swaps the page header, so the focused Back/Forward button is removed and focus falls to BODY.
  - **Where:** `apps/web/src/components/history-nav.tsx`, `page.tsx`.
  - **Why low:** it's on a less-used control. Browser Back (the common route) is unaffected, and the next Tab starts from the top.
  - **Fix:** render the history nav once outside the swapped header, or refocus the same control by a stable key after the page swaps.

- **get_view never says a past version is showing.**
  - **What:** `get_view` leaves out `ui.preview`, so an agent can't tell that the person is looking at a past version rather than the latest.
  - **Where:** `apps/web/src/lib/webmcp.ts`, `getView`.
  - **Why low:** agent-only. Edits still go to the latest version correctly.
  - **Fix:** add `preview: { version, at } | null` to the view, and document it in the tool description.

- **The hidden live editor's `inert` is redundant, and its comment credits the wrong thing.**
  - **What:** `hidden`, plus clearing the leftover selection, already keeps input out. Removing `inert` passes 60/60 runs, but the comment says `inert` is what stops the edits.
  - **Where:** `apps/web/src/components/editor.tsx` (the comments at about lines 100 and 244, and the `inert={!!previewing}` on the live wrapper).
  - **Why low:** harmless, it's only belt and braces.
  - **Fix:** fix the comment to credit `hidden` and clearing the selection. Keep or drop `inert`, but say which does the work.

- **Library multi-select is still hand-rolled.**
  - **What:** selection, Space, ⌘A, Escape and the marquee are custom, where React Aria's `GridList` could own keyboard selection.
  - **Where:** `apps/web/src/lib/selection.ts`, `components/diagram-card.tsx`, `components/marquee.tsx`.
  - **Why low:** it works. A1's GridList attempt was dropped for performance and because it broke the cards' link behaviour.
  - **Fix:** revisit when GridList supports link items without the per-item cost, or virtualize the grid first.

- **No e2e test for downloading a backup or importing a valid one.**
  - **What:** these flows are only covered by core unit tests and hand checks. (The trash's Restore and Delete forever now have e2e tests in `e2e/library.spec.ts`, from A2's focus fix.)
  - **Where:** `e2e/settings.spec.ts`.
  - **Why low:** core covers the logic, and A2's audit checked them by hand on three engines.
  - **Fix:** add a download-and-reimport round trip.

- **An agent that deletes the line after the one the person pressed Enter on glues the person's new line to the next.**
  - **What:** base `graph LR\n  A --> B\n  C --> E\n  A --> A\n`, the person adds `\n  P --> X` at the end of `A --> B`, and the agent deletes `C --> E`. The result is `"graph LR\n  A --> B\n\n  P --> X  A --> A\n"`. The last-line variant gives `"graph TD\n  B --> C  P --> X\n"`.
  - **Where:** `packages/core/src/store.ts`, `mergeFromBase` (a whole-line deletion next to the person's insert).
  - **Why low:** the agent's deletion overlaps the person's edit, so nothing is lost and the text is in history. It's the same class as upstream #7 and "A heavy agent rewrite can drop what the person typed…".
  - **Fix:** none planned. Track it with the line-end tie issue (see A2's VERDICT).

- **A failed save still tells other tabs to save on top of it.**
  - **What:** `persistDoc` broadcasts to other tabs in `finally`, even when its IndexedDB write failed. Another tab then saves its later edits as updates on top of the missing one. If the failing tab closes before it retries, a fresh load can't apply those updates, and all of the other tab's later edits are dropped.
  - **Where:** `packages/core/src/docs.ts`, `persistDoc`'s queue. Repro: A3 `core/gap.test.ts`.
  - **Why low:** it needs a failed write (a full disk, see "On a full disk, edits look saved…"), two tabs on one diagram, and the failing tab closing before its next write fills the gap.
  - **Fix:** broadcast only after a successful write. After a gap-filling compact, broadcast the full update.

- **One damaged diagram makes Download backup fail for the whole library.**
  - **What:** `exportBackup` loads each diagram in turn. One that can't be loaded rejects the whole export, so the person gets no backup at all.
  - **Where:** `packages/core/src/store.ts`, `exportBackup`. Repro: A3 `core/corrupt.test.ts`.
  - **Why low:** it needs a damaged stored diagram. `repairRows` already keeps such a diagram from blocking startup.
  - **Fix:** catch per diagram, as `repairRows` does. Export the rest, and report the skipped ones in the UI and to the agent.

- **The source's Undo and Redo drop focus to the page on the last step.**
  - **What:** the toolbar's Undo and Redo use `disabled`. Pressing Undo from the keyboard until nothing is left disables the focused button, and focus falls to BODY. History's Back/Forward already use `aria-disabled` for this.
  - **Where:** `apps/web/src/components/editor.tsx`, `IconButton` (Undo and Redo, about lines 226–229 and 388–400).
  - **Why low:** ⌘Z in the source, the common route, is unaffected. Only the toolbar buttons, at the end of the history, lose focus.
  - **Fix:** `aria-disabled` and an early return in `onClick`, as in `history-nav.tsx`.

- **An agent's set_view previewVersion takes focus from the person, and "latest" doesn't give it back.**
  - **What:** while the person types in the source, an agent's `set_view({ previewVersion })` hides the live editor. Focus drops to BODY, and what the person types next goes nowhere. The agent's `previewVersion: "latest"` then leaves focus on BODY, unlike the person's own Back to latest, which focuses the source at its caret.
  - **Where:** `apps/web/src/components/editor.tsx` (the preview switch) and `apps/web/src/lib/webmcp.ts` (`previewVersion`). Found by A3's editor and webmcp audits.
  - **Why low:** it needs an agent to open a past version while the person is typing. Nothing typed is saved anywhere wrong, and one click on the source gets back.
  - **Fix:** when a past version opens while focus is in the live source, focus the read-only editor. When the view returns to latest and focus is on BODY or in the past version's editor, focus the live source at its caret, with the same `CodeEditorHandle.focus()` that Back to latest uses.

- **The version history popover is a nameless dialog.**
  - **What:** the history popover has `role=dialog` but no accessible name, which fails axe's `aria-dialog-name`.
  - **Where:** `apps/web/src/components/history-menu.tsx`.
  - **Why low:** its focused items name themselves, and the trigger says "History".
  - **Fix:** `aria-label="Version history"` on the popover content.

- **The editor page has no heading, and its splitters have no name.**
  - **What:** a screen reader's heading navigation finds nothing on a diagram's page, and the resize handles between the panes are announced as unnamed separators.
  - **Where:** `apps/web/src/components/editor.tsx`, `page.tsx` (the editor's header); the resizable panel handles.
  - **Why low:** the title field is labelled and is the first stop, and the splitters are pointer conveniences with a fixed default layout.
  - **Fix:** a visually hidden `<h1>` with the diagram's title (or the title field inside an `h1`), and `aria-label="Resize source and preview"` (and so on) on each handle.

- **A concurrent edit at the edge of an IME composition leaves the composed letters behind (CodeMirror, upstream).**
  - **What:** while composing (pinyin `ni` at the end of `A --> B`), another tab's or an agent's edit that replaces, inserts at, or deletes the character just before the composition leaves `ni` in the text when `你` commits: `A --> Cni你`. The editor and the store agree.
  - **Where:** CodeMirror's composition tracking. Eos dispatches the change with a plain `view.dispatch({ changes })` (`apps/web/src/components/code-editor.tsx`). Repro: A3 `editor/probes/ime2.spec.ts`.
  - **Why low:** it needs a concurrent edit exactly at the composition's edge, and the letters are visible and can be deleted.
  - **Fix:** none in Eos. Tracked upstream (see A3's VERDICT for the issue text). Confirm on a bare CodeMirror page before filing.

- **set_view's previewVersion rejects versions that get_diagram accepts.**
  - **What:** `get_diagram({ version })` reads any version the diagram has, including ones from earlier tool results that history has since folded into a later entry. `set_view({ previewVersion })` only accepts a version it finds among `eos.history(id, 500)`'s entries, so the same id returns not_found.
  - **Where:** `packages/webmcp/src/index.ts`, `set_view` (about lines 450–458).
  - **Why low:** agent-only, and the error says to use an id from get_diagram's history.
  - **Fix:** look the version up the way `get_diagram` does (`eos.getSource` succeeds), and label it from the nearest history entry.

- **get_settings's description promises the full app CSS, but returns only the saved override.**
  - **What:** the description says "the full app --eos-* and diagram --pele-* CSS including defaults". Once the person saves a theme, it returns only their override.
  - **Where:** `packages/webmcp/src/index.ts` (the `get_settings` description, about line 235) and `apps/web/src/lib/webmcp.ts` (what it returns).
  - **Why low:** agent-only. The agent still gets the variables in effect that were changed, and `set_theme` works either way.
  - **Fix:** return the defaults merged with the override, as the description says, or change the description to "your saved overrides; defaults otherwise".

- **update_diagram's "the agent's own source edits" undo is shared by all agents in a tab.**
  - **What:** `revert: "undo"` steps through one agent undo stack per tab. Every agent in that tab shares it, and it isn't kept across reloads. The description says "the agent's own source edits".
  - **Where:** `packages/webmcp/src/index.ts`, the `update_diagram` description (about line 333); the agent undo stack in `packages/core/src/store.ts`.
  - **Why low:** one agent per tab is the normal case, and a version id still restores exactly.
  - **Fix:** say "agent edits made in this tab (all agents), until it reloads".

- **Some agent errors don't say what's wrong.**
  - **What:** `get_library({ filters: { tags: [...many] } })` fails with Zod's bare `too_big`, and `set_view` with many `filters.tags` fails with the same bare `too_big`. `set_view({ page: "diagram" })` without `diagramId` returns `not_found` for `undefined`, rather than saying diagramId is required.
  - **Where:** `packages/webmcp/src/index.ts`, the `get_library` schema and `set_view` (about lines 445–448). The second is related to "set_view's previewVersion needs diagramId…".
  - **Why low:** agent-only. A retry with a valid input works.
  - **Fix:** describe the limit in the schema. In `set_view`, fail with "page \"diagram\" needs diagramId", or default to the open diagram.

- **Two first-visit tabs each seed "Welcome to Eos", and a restore into a new browser adds a second one.**
  - **What:** a first visit seeds the sample diagram. Two tabs opened at once on a first visit both seed it, and the library shows two "Welcome to Eos". Restoring a backup in a fresh browser keeps the just-seeded Welcome next to the backup's own.
  - **Where:** `packages/core/src/store.ts` (first-run seeding from `samples.ts`) and `importBackup`.
  - **Why low:** it's a duplicate sample, not lost data, and it can be deleted.
  - **Fix:** seed under a Web Lock (`navigator.locks.request("eos-seed", …)`) and re-check inside it. On a replace import, drop an untouched seeded Welcome.

- **The theme parser breaks on a ";" inside a quoted value.**
  - **What:** `parseVars` splits declarations with a regex. A value like `--x: "a;b";` ends at the quoted `;`, swallows the next declaration, and saves broken CSS.
  - **Where:** `apps/web/src/lib/theme.ts`, `parseVars` (about line 51). Repro: A3 `arch/specs/css.spec.ts`.
  - **Why low:** custom properties with quoted semicolons are rare in a theme.
  - **Fix:** platform-first. Parse with `new CSSStyleSheet().replaceSync(css)` and walk the rules' `style` declarations, keeping `--*` properties.

- **preview.spec's "after Back to latest/Restore, focus is back in the source" can time out under load.**
  - **What:** it failed once each on Firefox and WebKit under the full suite. The Restore's IndexedDB write sometimes outlasts the default 4 s expect, and it passed 30/30 with a 15 s timeout. It isn't a product race.
  - **Where:** `e2e/preview.spec.ts` (about line 553).
  - **Why low:** test timing only.
  - **Fix:** `test.slow()`, or a longer timeout on that one assertion.

- **Clear or Escape can focus another copy of the card, when grouped by subtag.**
  - **What:** grouped by subtag, one diagram shows once per group. `focusOffSelection` remembers the last-toggled card by id, so it focuses the first copy, not the one the person toggled.
  - **Where:** `apps/web/src/lib/selection.ts` (`lastToggled`), `components/diagram-card.tsx` (`toggleSelected` callers).
  - **Why low:** focus lands on the same diagram, in view, and nothing scrolls.
  - **Fix:** remember the toggled card element (or its group key with the id), and prefer it when it's still connected.

- **On phones, focus moved off the selection bar can land on a card hidden under the sticky header.**
  - **What:** when no better target is in view, the fallback takes the topmost card in view. On a phone, where the page scrolls under a sticky header, that card can be all but covered.
  - **Where:** `apps/web/src/lib/selection.ts`, `inView`.
  - **Why low:** a fallback of a fallback. The card is focused, and the next arrow or Tab scrolls it in.
  - **Fix:** take the sticky header's bottom as the top edge (or require the card's centre to be visible).

- **tags.spec's "a card dragged onto a tag…" can fail on Firefox before the second card is tagged.**
  - **What:** `Store.addTags` tags the dragged selection one diagram after another. The test polls only the first ("Two") and then reads "Three" once, and on Firefox about 1 run in 4 that read comes before Three's write. The failure's page snapshot shows both cards tagged. It predates A2, with no load.
  - **Where:** `e2e/tags.spec.ts` (about lines 152–153).
  - **Why low:** test only. Every selected card is tagged.
  - **Fix:** poll both, for example `expect.poll(async () => [(await diagram("Two")).tags, (await diagram("Three")).tags])`. Do the same for the Starred drag at lines 155–158.

- **Search for a Mermaid arrow misses diagrams where the arrow touches a word.**
  - **What:** the tokenizer keeps `-` and `'` inside words (`split(/[^\p{L}\p{M}\p{N}_'-]+/u)`), so `x-->y` is indexed as one token. A search for `-->` or `->>` finds `A --> B` but not `A-->B`.
  - **Where:** `packages/core/src/search.ts`, the tokenizer (about line 26).
  - **Why low:** the diagram is still found by its node names, and searching for an arrow is rare. Found by A4's core audit.
  - **Fix:** trim leading and trailing `-` and `'` from each token. Or split a token at a run of two or more `-`, and drop tokens with no letter or digit. Keep the hyphenated-word and apostrophe tests green.

- **A failed idle preload of the editor is never retried, and then says "Eos has been updated".**
  - **What:** if the idle `loadEditor()` fails (for example, the network drops just after the page loads), the browser caches the failed module import. Every later open of a diagram, and since A3 of Settings, fails until a reload. Once back online, `vite:preloadError` records `"updated"`, so the boundary says "Eos has been updated" although nothing was deployed.
  - **Also:**
    - `failed` is never cleared, so a later, unrelated render error shows that stale message instead of "Something went wrong".
    - `void loadEditor()` leaves an unhandled rejection.
  - **Where:** `apps/web/src/App.tsx` (`loadEditor`, the idle preload), `apps/web/src/components/settings-dialog.tsx:34`, `apps/web/src/components/error-boundary.tsx`.
  - **Why low:**
    - It needs the preload to fail in the moment after load.
    - The advice (Reload) is right and does fix it.
    - The common offline cases already say "offline" since A3.
    - Found by A4's editor, settings and arch audits.
  - **Fix:** no retry wrapper, since the cached failure is platform behaviour.
    - Catch the idle preload (`loadEditor().catch(() => {})`).
    - Say "updated" only when the failed chunk's response was a 404, not just when `navigator.onLine` is true. Otherwise say "Part of Eos couldn't load. Reload to try again."
    - Clear `failed` once the boundary has shown it.

- **A view change while focus is in the selection bar or its Tags menu drops focus to the page.**
  - **What:** an agent's `set_view` filter change, or the browser's Back or Forward shortcut pressed while a bar button has focus, empties the selection from `home.tsx`'s route effect. `focusOffSelection` then picks a card from the old view, which unmounts when the new rows render, so focus falls to BODY.
  - **Where:** `apps/web/src/components/home.tsx:72` (`clearSelection()` on `route.tag`/`starred`/`deleted`), `apps/web/src/lib/selection.ts`. Repros: A4 `webmcp/s/t4.mjs`, `t5.mjs`, `t10.mjs`.
  - **Why low:**
    - In-app view changes (sidebar, drawer) move focus off the bar first.
    - This needs an agent, or a browser shortcut pressed from the bar.
    - It is the same class as "An agent's set_view previewVersion takes focus from the person".
    - Found by A4's library and webmcp audits.
  - **Fix:** on a view change, target the library scroller instead of an old-view card. For example, focus `.eos-library-scroller` (preventScroll) in home's route effect when focus is in the bar or menu. Or move focus after the new rows render.

- **The "card in view" fallback can land on a card that the removal then moves off-screen.**
  - **What:** when the next card is out of view, `focusOffSelection` picks the first remaining card in view before the removed cards leave. The grid then reflows, and that card can end up just outside the scroller. This happened 5 of 5 times for trash Restore and Delete forever after selecting the first card and scrolling to the end. It also happens with desktop Delete when scrolled, and on phones.
  - **Where:** `apps/web/src/lib/selection.ts`, `inView` and the fallback. Repro: A4 `library/scroll.probe.ts`.
  - **Why low:**
    - Focus is on a card, not BODY.
    - The next Tab or arrow scrolls it in.
    - It needs the person to scroll well away from what they selected.
    - It is related to "On phones, focus moved off the selection bar can land on a card hidden under the sticky header". Fix the two together.
  - **Fix:** require the card to sit fully inside the scroller (with the sticky header's bottom as the top edge on phones), and prefer one near the middle. Or choose the target after React re-renders, from the cards that remain.

- **An agent's confirm answered while focus is in the Tags menu drops focus to the page.**
  - **What:** with focus in the selection bar's Tags menu, an agent's tool opens a confirm (delete, for example). Answering it leaves focus on BODY in 3 of 3 engines (A5). The first Escape only closes the menu. A4 saw it in 2 of 5 Firefox runs for an agent's delete.
  - **Where:** `apps/web/src/components/tag-menu.tsx`, `apps/web/src/lib/selection.ts`, and the confirm in `packages/ui` Dialog. Repros: A4 and A5 `library/agentdel.probe.ts`.
  - **Why low:** it needs an agent's confirm while the person has the menu open. Nothing is lost, and one Tab gets back. Found by A4's and A5's library audits.
  - **Fix:** close the Tags popover before a confirm opens, so the dialog returns focus to the bar or a card. Or, when the confirm closes and its opener is gone, fall back to the selection bar or `setSelection`'s focus target.

- **accessibility.spec's "2 selected" step can fail on Firefox under parallel load.**
  - **What:** after `goto("/#/")`, the test right-clicks card 0 and clicks card 1 before the whole library has rendered. The second click can land on a card that is then re-rendered, so "2 selected" never shows.
  - **Where:** `e2e/accessibility.spec.ts` (about line 73).
  - **Why low:** test only. Found by A4's settings audit.
  - **Fix:** wait for the full card count (`await expect(cards).toHaveCount(n)`) after `goto("/#/")`, before selecting.

- **The selection bar's Tags menu has no arrow keys, and in WebKit plain Tab skips its rows.**
  - **What:** the rows are plain `role="checkbox"` buttons in a Radix Popover.
    - Arrow keys do nothing in any engine. An earlier version of this entry said they reach the rows; they don't.
    - Chromium and Firefox Tab through the rows.
    - In WebKit, plain Tab goes from the search to a Radix focus guard, then to BODY, because Safari doesn't Tab to buttons unless "Press Tab to highlight each item" is on.
    - ⌥Tab reaches every row, Space toggles it, and typing a tag plus Enter in the search toggles it.
  - **Where:** `apps/web/src/components/tag-menu.tsx`, and e2e `tags.spec.ts` (the created-tag test skips its Tab step on WebKit). Repro: A5 `arch/t/arrows.spec.ts`.
  - **Why low:**
    - Every row is keyboard-reachable in every engine. On WebKit that's with ⌥Tab, as for every button in Eos, including the Tags button itself.
    - One Tab stop per checkbox plus Space is the APG checkbox pattern.
    - Nothing is lost.
    - Found by A4 and A5's arch audits. The A5 gatekeeper verified ⌥Tab, Space and search+Enter on WebKit.
  - **Fix:** if it's rebuilt, use React Aria Components' `Autocomplete` with a `Menu` or `ListBox` (`selectionMode="multiple"`, already a dependency). That gives arrows, one Tab stop and virtual focus from the search.
    - Selection there is a key Set with no tri-state, so the "some" state (`aria-checked="mixed"`) must be rendered by hand.
    - A4's ghost rows and focus rules must be re-proven.
    - The rebuild also fixes "The selection bar's Tags popover is a nameless dialog" and "The Tags menu's Create button drops focus to the page". It doesn't fix the ghost-row entries below, which are state logic.

- **A ghost row in the Tags menu outlives a rename or delete made elsewhere.**
  - **What:** since A4, a tag the open Tags menu unchecked (its last use) keeps a ghost row. If another tab or an agent renames or deletes that tag while the menu is open, the ghost keeps the old name, and checking it re-creates the old tag. A nested tag's ghost can also move to the end of the list when its parent goes with it.
  - **Where:** `apps/web/src/components/tag-menu.tsx` (`unchecked`, `shown`). Repros: A5 `library/tabs.probe.ts`, `library/ghost.probe.ts`, `webmcp/s/tm1.mjs`.
  - **Why low:** it needs a concurrent rename or delete during an open menu. The re-created tag is visible and can be removed. Found independently by A5's library and webmcp audits.
  - **Fix:** keep a ghost only while the tag's record is gone because this menu removed its last use. Drop it when the record changes for any other reason (a rename or delete elsewhere). Store the neighbour's path, not an index, to keep its place.

- **The Tags menu shows a ghost row and "Create" for the same name.**
  - **What:** after unchecking a tag's last use, typing that name in the search shows both its ghost row and "Create “name”", which do the same thing.
  - **Where:** `apps/web/src/components/tag-menu.tsx`, `canCreate` (checks `all`, not `shown`).
  - **Why low:** both work and give the same result. Found by A5's arch audit.
  - **Fix:** `canCreate = !!newTag && !shown.some((t) => t.path === newTag)`.

- **The Tags menu's Create button drops focus to the page.**
  - **What:** activating "Create “name”" by click, or by Tab + Enter, clears the query, so the button unmounts and focus falls to BODY. Enter in the search is fine.
  - **Where:** `apps/web/src/components/tag-menu.tsx`, `create`.
  - **Why low:** it predates A4, and Enter in the search (the usual path) keeps focus. Found by A5's library audit.
  - **Fix:** focus the search input after `create()` (a ref on `Input`).

- **An agent's rename of the focused Tags-menu row drops focus to the page.**
  - **What:** with focus on a Tags-menu row, an agent's `update_tag` rename re-keys the row (`key={t.path}`), and focus falls to BODY.
  - **Where:** `apps/web/src/components/tag-menu.tsx`. Repro: A5 `webmcp/s/tm2.mjs`.
  - **Why low:** it needs an agent rename during an open menu. Found by A5's webmcp audit.
  - **Fix:** when the focused row's path disappears and a renamed record takes its place, focus the row at the same index (the same approach as the moved-row refocus in tag-tree).

- **The selection bar's Tags popover is a nameless dialog.**
  - **What:** the Tags `PopoverContent` has `role="dialog"` and no accessible name, which fails axe's `aria-dialog-name` (serious). Its search input is named only by its placeholder.
  - **Where:** `apps/web/src/components/tag-menu.tsx`. Repro: A5 `arch/t/menuname.spec.ts`.
  - **Why low:** the trigger says "Tags", and each row names itself. This is the same class as "The version history popover is a nameless dialog". Found by A5's arch audit.
  - **Fix:** `aria-label="Tags for the selected diagrams"` on `PopoverContent`, and `aria-label="Find or create a tag"` on the input.

- **A restore in one tab, then ⌘Z in another, duplicates the restored line.**
  - **What:** `restoreVersion` clears the undo stacks only in its own tab. Another tab's next ⌘Z undoes an edit from before the restore against the restored text, and that can duplicate a line.
  - **Where:** `packages/core/src/store.ts`, `restoreVersion` (about line 418), and `listenToOtherTabs`. Repro: A5 `core/xrestore.test.ts`.
  - **Why low:** it needs two tabs on one diagram, a restore in one and an undo in the other. It's visible, undoable, and kept in history. Found by A5's core audit.
  - **Fix:** broadcast a "restored" message, so other tabs clear that diagram's undo stacks.

- **Malformed version ids get through `frontiersOf`.**
  - **What:** ids like `"peer:"` or `"peer:0x1"` parse, so `restoreVersion` and `previewVersion` can act on a bogus frontier, and a restore can empty the diagram.
  - **Where:** `packages/core/src/store.ts`, `frontiersOf` (about line 1092). Repro: A5 `core/ver.test.ts`.
  - **Why low:** only an agent passes raw ids, and the emptied text stays in history. Found by A5's core audit.
  - **Fix:** require each part to match `/^\d+:\d+$/` before parsing, and return not_found otherwise.

- **Comment text on the highlighted error line fails contrast.**
  - **What:** inside `.cm-error-line`, Mermaid comment tokens are 4.19:1 (light) and 3.91:1 (dark), below 4.5:1. axe's `color-contrast` flags them.
  - **Where:** `apps/web/src/components/code-editor.tsx` (`.cm-error-line`'s 12% red tint) and the comment token colour.
  - **Why low:** it only affects comment text on the one error line. Found by A5's editor audit.
  - **Fix:** lighten the tint, or darken the comment colour inside `.cm-error-line`.

- **set_view with page "diagram" ignores zoom.**
  - **What:** `set_view({ page: "diagram", diagramId, zoom })` opens the diagram, but the zoom is applied before the preview mounts, so it's lost, and the result reports the old zoom.
  - **Where:** `packages/webmcp/src/index.ts`, `set_view` (about line 465). Repro: A5 webmcp.
  - **Why low:** agent-only, and a second `set_view({ zoom })` works. Found by A5's webmcp audit.
  - **Fix:** apply the zoom after navigation settles (or keep it as pending UI state the preview reads on mount), and report the zoom actually applied.

- **update_tag reports ok for nothing, and stores any text as the emoji.**
  - **What:** `update_tag` on a nonexistent path, or with an empty `moveTo`, returns ok without changing anything. `emoji` accepts any string, not one grapheme. `update_tag` echoes `moveTo` as typed, not normalised, and `delete_tag` with a blank path shows a confirm and then returns ok.
  - **Where:** `packages/webmcp/src/index.ts`, `update_tag` (about lines 403–415).
  - **Why low:** agent-only, and nothing is damaged. Found by A5's webmcp audit.
  - **Fix:** return not_found for an unknown path and invalid_input for an empty `moveTo`. Validate the emoji as a single grapheme (`Intl.Segmenter`).

- **After Delete all, or emptying the trash, "Welcome to Eos" comes back on the next reload.**
  - **What:** startup seeds the samples whenever the `diagrams` store is empty, so a library deliberately emptied gets the sample back.
  - **Where:** `packages/core/src/store.ts` (about line 152, the `db.count("diagrams") === 0` seed). Related: "Two first-visit tabs each seed "Welcome to Eos"…".
  - **Why low:** it's a sample, not lost data, and it can be deleted again. Found by A5's settings audit.
  - **Fix:** record a "seeded" marker in the workspace doc (or a meta row), and seed only when it's absent. Fix it together with the Web Lock seeding entry.

- **A missing /assets/ file is answered with index.html and cached for a year.**
  - **What:** the SPA fallback serves index.html (200, text/html) for a missing `/assets/*`, and `_headers` marks it `immutable, max-age=31536000`.
  - **Where:** `apps/web/public/_headers`, and the Workers/Pages asset config.
  - **Why low:** hashed asset URLs that are missing are already dead, and the chunk-failure UI still shows. Found by A5's settings audit.
  - **Fix:** return 404 for missing `/assets/*` (for example `assets.run_worker_first` for `/assets/*`, or `not_found_handling` scoped away from assets).

- **A lost cross-tab message leaves the other tab holding that tab's later edits as pending.**
  - **What:** if a tab closes between writing an update and broadcasting it, the other tab's Loro `import()` reports later updates from that tab as `pending` and Eos ignores it. That tab's editor stops showing them, its next row write overwrites the good row, and its backup leaves the edits out. Disk keeps every update, and a reload heals it. A fuzz diverged in 3 of 10 seeds, only right after an abrupt reload; 28 of 28 converged with graceful reloads.
  - **Where:** `packages/core/src/store.ts` (about line 1009, where the import result is ignored).
  - **Why low:** it needs a tab to die mid-write, nothing on disk is lost, and a reload recovers.
  - **Fix:** when `import()` reports `pending`, reload that diagram from disk (`loadDoc` + import). Repro: `a6/core/lost.test.ts`.

- **⌘Z after an agent edits the person's freshly typed line can leave fragments.**
  - **What:** the person types a line, an agent edits that line, and the person's ⌘Z removes their characters one by one around the agent's, leaving text such as "Rdis". Redo restores it.
  - **Where:** `packages/core/src/store.ts`, the Loro UndoManager setup that skips agent changes.
  - **Why low:** it needs an agent edit on the very line just typed, and redo restores the text.
  - **Fix:** none cheap; it follows from Loro's per-character undo with agent changes excluded. Repro: `a6/core/residue.test.ts`.

- **The deleted-diagram banner's Restore drops focus to BODY.**
  - **Where:** `apps/web/src/components/editor.tsx:213-221`.
  - **Why low:** the diagram is restored and the editor works; only focus is lost, on an occasional path.
  - **Fix:** do what Back to latest does: `flushSync` the restore, then `editorRef.current?.focus()`.

- **Version history shows only the latest 100 versions, with no hint that older ones exist.**
  - **Where:** `apps/web/src/components/history-menu.tsx:23`.
  - **Why low:** only long-lived diagrams have more than 100 versions, and the recent ones are the ones usually wanted.
  - **Fix:** raise the limit, or add a "Show older" row when the limit is reached.

- **Shortcut hints always show ⌘, also on Windows and Linux.**
  - **Where:** `apps/web/src/components/editor.tsx`, `apps/web/src/components/export-menu.tsx`.
  - **Why low:** the shortcuts work with Ctrl; only the hint text is wrong.
  - **Fix:** choose ⌘ or Ctrl once from the platform and use it in every hint.

- **The selection bar can't unstar.**
  - **What:** the bar always offers Star. In the Starred view, Star on starred cards does nothing, and there's no Unstar.
  - **Where:** `apps/web/src/components/selection-bar.tsx` (`eos.setStarred(ids, true)`).
  - **Why low:** each diagram can still be unstarred from the editor.
  - **Fix:** show Unstar when every selected card is starred (or make Star a toggle with `aria-pressed`). Repro: `a6/library/s/t15.mjs`.

- **A broken card's accessible name starts with "Can't render".**
  - **What:** a card whose source doesn't render reads "Can't render Broken one …" to a screen reader, before its title.
  - **Where:** `apps/web/src/components/diagram-card.tsx:163`.
  - **Why low:** the title is still in the name, and it's honest about the card.
  - **Fix:** `aria-hidden` the placeholder text, and put "can't render" in the card's description instead. Repro: `a6/library/s/t16.mjs`.

- **Search doesn't match tag names.**
  - **Where:** `packages/core/src/search.ts` (the MiniSearch fields).
  - **Why low:** the tag tree filters by tag, and search finds titles and source.
  - **Fix:** index each diagram's tag paths as a searchable field.

- **A tag row's actions are hard to discover by keyboard or screen reader.**
  - **What:** the row menu (Change icon, Move to top level, Delete tag) opens only on right-click, the ContextMenu key or Shift+F10, and nothing on the row says so.
  - **Where:** `apps/web/src/components/tag-tree.tsx`.
  - **Why low:** the standard context-menu keys work in every engine; this is discoverability, not access.
  - **Fix:** add `aria-haspopup="menu"` and a description ("Shift+F10 for actions") to each row, or a visible "…" button that shows on focus.

- **get_settings right after set_theme({ mode }) reports the old theme.**
  - **What:** `applyTheme` runs in an effect, so `get_settings` straight after `set_theme({ mode })` returns the previous resolved mode and CSS. An agent that then calls `set_theme({ appCss })` can save light values as dark overrides.
  - **Where:** `packages/webmcp/src/index.ts` (`set_theme`), `apps/web/src/lib/webmcp.ts` (`getTheme`).
  - **Why low:** agent-only, and needs that exact sequence.
  - **Fix:** `await ui.settled()` in `set_theme` before returning, or derive `resolvedMode` from the saved settings. Repro: `a6/webmcp/probes/p9.mjs`, `p10.mjs`.

- **An agent's rename replaces a title the person is typing.**
  - **Where:** `apps/web/src/components/editor.tsx` (`TitleInput`).
  - **Why low:** deliberate (see the TitleInput comment); the person can type again, and undo of the title isn't promised.
  - **Fix:** none planned; revisit if title edits get a merge.

- **Agent input edge cases are accepted silently.**
  - **What:** `baseVersion: ""` is treated as no base; `get_diagram` can return version `""`; `set_theme({ appCss: "hello" })` is stored, and the app falls back to defaults while `overridden.app` is true.
  - **Where:** `packages/webmcp/src/index.ts`.
  - **Why low:** agent-only; nothing is damaged and a valid call fixes it.
  - **Fix:** reject an empty `baseVersion`; validate `appCss` parses to at least one declaration before saving.

- **A broken or truncated share link drops the person into the library with no message.**
  - **Where:** `apps/web/src/App.tsx` (`useShareImport`). docs/data-model.md §6 documents the behaviour.
  - **Why low:** documented, and nothing is lost; the sender can resend.
  - **Fix:** show a one-line alert ("This share link is incomplete or damaged").

- **The editor Star, the selection bar's Star and share-link import have no e2e test.**
  - **What:** breaking all three still passes the full e2e suite (798/798).
  - **Where:** `e2e/library.spec.ts`, `e2e/navigation.spec.ts`.
  - **Why low:** the features work today; only regressions would go unnoticed.
  - **Fix:** add one test each: star from the editor and see the card in Starred; star two cards from the bar; open a `#/import` link and see the diagram.

- **Chromium resets the library's scroll position when the window goes from phone width to desktop.**
  - **What:** crossing 768px from phone to desktop puts the library back at the top in Chromium; Firefox and WebKit keep the position. The page now stays mounted across the breakpoint, so this is the scroller swapping (document on phones, the panel on desktop), not a remount.
  - **Where:** `apps/web/src/App.tsx` (Shell), `apps/web/src/lib/scroll-restore.ts`.
  - **Why low:** it needs a resize across the breakpoint while scrolled; nothing is lost.
  - **Fix:** carry the scroll offset across the scroller change (restore it to the new scroller after the layout switch).

- **On phones, an open drawer comes back after a rotation to landscape and back.**
  - **What:** `mobileNavOpen` is reset only when the URL changes. If the drawer is open and the phone is rotated past 768px (the desktop layout), then rotated back, the drawer reopens. It also happens after resizing a window phone → desktop → phone. Found by A8's library, webmcp and settings audits.
  - **Where:** `apps/web/src/App.tsx` (Shell, `mobileNavOpen`).
  - **Why low:** it's the drawer the person last opened, and it closes as usual.
  - **Fix:** set `mobileNavOpen` to false when `useIsMobile()` turns false.

- **Crossing 768px drops focus from the library's Search box.**
  - **What:** phones and desktop each render their own Search input, so focus in one falls to BODY when the layout switches. The query is kept.
  - **Where:** `apps/web/src/components/home.tsx` and `App.tsx` (the two Search inputs).
  - **Why low:** it needs a resize or rotation mid-search; one tap or click puts focus back.
  - **Fix:** render one Search input and move it with CSS, or refocus the other input on the switch if it had focus.

- **Desktop Hide sidebar and Show sidebar drop focus to the page.**
  - **What:** activating either button by keyboard removes the button that has focus, so focus lands on BODY.
  - **Where:** `apps/web/src/App.tsx` (sidebar collapse controls).
  - **Why low:** the same class as the other "drops focus to the page" entries. The next Tab reaches the page.
  - **Fix:** after the toggle, focus the counterpart button (Show after Hide, and the reverse).

- **Closing Settings after crossing 768px drops focus to the page.**
  - **What:** the dialog returns focus to its opener, but the opener belonged to the other layout and is gone.
  - **Where:** `packages/ui` Dialog (return focus) and the Settings openers in `App.tsx`.
  - **Why low:** it needs a resize while Settings is open.
  - **Fix:** if the opener is no longer connected, return focus to the current layout's Settings button.

- **After Save, switching color mode keeps the saved App CSS in the editor.**
  - **What:** before Save, the App CSS editor pre-fills the active mode's values. After Save it shows the saved override, so switching Light/Dark leaves the other mode's values on screen. These are the values the override applies.
  - **Where:** `apps/web/src/components/settings-dialog.tsx` (app pre-fill effect on `theme.mode`).
  - **Why low:** nothing is lost, and what's shown is what applies; it can just surprise.
  - **Fix:** say under the editor that saved CSS applies to both modes, or store the override per mode.

- **Exporting a very tall diagram as PNG fails with only "PNG export failed".**
  - **What:** the export draws at 2×, which passes the browser's canvas size limit for very tall diagrams.
  - **Where:** the PNG export in `apps/web` (export helper) and webmcp `export_diagram`.
  - **Why low:** only very tall diagrams; SVG export works.
  - **Fix:** scale down to fit the canvas limit, or say why it failed and suggest SVG.

- **Small landscape phones show only 1–2 lines of source.**
  - **What:** the stacked editor split (42/58) leaves the Source pane about 30px tall on an iPhone SE in landscape (667×320).
  - **Where:** `apps/web/src/components/editor.tsx` (the phone split via `setLayout`).
  - **Why low:** the splitter can be dragged; portrait works; it predates A7.
  - **Fix:** below about 400px tall, give the source a minimum size (e.g. 50%), or put the panes side by side in landscape.

- **A short search prefix-matches the diagram type keyword.**
  - **What:** "flow" matches `flowchart` and "seq" matches `sequenceDiagram`, so nearly every diagram is a hit.
  - **Where:** `packages/core/src/search.ts` (MiniSearch matches prefixes).
  - **Why low:** since the A8 ranking batch, whole-word matches rank first and these trail at the bottom; only the hit count is inflated.
  - **Fix:** index the header keyword in a separate, unboosted field, or leave it out of `source`.

- **At 320px wide the Version history popover runs 8px off the right edge.**
  - **What:** the popover is `w-80` (320px) with `collisionPadding={8}`, so on a 320px screen it can't fit and overhangs the right edge by 8px. Its content stays readable and every version can be picked. A side effect of A8's collisionPadding.
  - **Where:** `apps/web/src/components/history-menu.tsx` (the popover content's width).
  - **Why low:** only at 320px; nothing is cut off that matters.
  - **Fix:** `w-[min(20rem,calc(100vw-1rem))]`.

- **The search box has no clear button and Escape doesn't clear it.**
  - **What:** a plain text input with no clear control; Escape leaves the query in place. Clearing means selecting the text and deleting it.
  - **Where:** `apps/web/src/components/home.tsx` (the search input).
  - **Why low:** the query is easy to delete by hand; nothing is lost.
  - **Fix:** a clear button (with an accessible name) shown while there's a query, and Escape clears a non-empty query (a second Escape blurs).

- **The Group select is enabled but does nothing while searching.**
  - **What:** since A8, search results are one flat list, but the Group select stays enabled, so changing it while searching has no visible effect until the search is cleared.
  - **Where:** `apps/web/src/components/home.tsx` (the Group select).
  - **Why low:** grouping applies again once the search is cleared, as docs/data-model.md says.
  - **Fix:** disable it while a query is active, with a hint ("Search results are ranked"), or mark it `aria-disabled` with a tooltip.

- **get_library returns about 36k tokens for a 300-diagram library.**
  - **What:** at ~300 diagrams, `get_library` returns ~127 KB; `sourcePreview` is about half of it.
  - **Where:** `packages/webmcp/src/index.ts` (`get_library`).
  - **Why low:** not a regression; agents can filter by tag or query, and read one diagram with `get_diagram`.
  - **Fix:** leave out `sourcePreview` by default (an `include: ["preview"]` option), or cap the list with a `limit`/`cursor`.

- **Settings' App CSS pre-fill doesn't follow a system light/dark change while Settings is open.**
  - **What:** with color mode System, switching the OS between light and dark while Settings is open leaves the App CSS editor showing the other mode's pre-fill. (Related to, but not the same as, "After Save, switching color mode keeps the saved App CSS in the editor.")
  - **Where:** `apps/web/src/components/settings*.tsx` (the App CSS pre-fill).
  - **Why low:** rare; reopening Settings shows the right pre-fill, and nothing is saved wrongly.
  - **Fix:** derive the pre-fill from the resolved mode (subscribe to `prefers-color-scheme`) while the field is untouched.

- **Importing a backup with an unknown version shows a cryptic Zod error.**
  - **What:** a backup file whose `v` is unknown (from a newer Eos, say) fails with a raw schema error instead of "This backup is from a newer version of Eos".
  - **Where:** `packages/core/src/backup*.ts` (import parsing).
  - **Why low:** nothing is changed or lost; only the message is unclear.
  - **Fix:** check `v` before the full schema parse and give a plain message.

- **WebKit: a preview.spec test can flake on a same-document `goto` plus resize.**
  - **What:** Playwright's `page.goto` to a hash URL of the current document, followed by a resize, can race with the Navigation API in WebKit, so `openEditor` sometimes lands on the old view.
  - **Where:** `e2e/helpers.ts` (`openEditor`), used by `e2e/preview.spec.ts`.
  - **Why low:** a test-harness flake; the app behaves.
  - **Fix:** open the editor with `location.hash = …` inside the page, or by clicking the card.

- **Two-letter searches like "es" or "as" match most flowcharts.**
  - **What:** short words count as the plural of a one-letter word, so "es" matches every node named E (and "as" the article "a") as a whole word; on a realistic flowchart library "es" goes from 2 results to 594. The intended title still ranks first.
  - **Where:** `packages/core/src/search.ts` (word forms via pluralize).
  - **Why low:** a noisy list while typing, not a buried result.
  - **Fix:** don't derive plural forms for words of 2 letters or fewer.

- **"checkin" buries "Check-in process".**
  - **What:** a hyphenated or apostrophe word is indexed whole and by its parts ("check-in" as "check-in", "check" and "in"), but not joined, so "checkin" only finds it as a typo, below closer matches.
  - **Where:** `packages/core/src/search.ts` (`partsOf`, and the terms `searchIndex` builds from it).
  - **Why low:** "check-in" and "check in" find it first; only the joined spelling ranks it low.
  - **Fix:** index the joined form too ("checkin", "sarahs") alongside the parts.

- **-ing forms undouble down to 3-letter stems, and miss 2-letter ones.**
  - **What:** "settings" counts "set" as the word whole ("sett" undoubled), and "getting" "get", so a search for "settings" ranks "Set password" #3. The other way, the -ing rule needs a stem of 3 letters, so "use" doesn't count "using" as the word: "Using Redis" ranks 148th of 417.
  - **Where:** `packages/core/src/search.ts` (`formsOf`, `undouble`).
  - **Why low:** the intended diagram is still found; it ranks a few places lower, or lower only for the bare verb.
  - **Fix:** weigh a derived form below the word itself, so "settings" prefers "setting" to "set"; and for a 2-letter -ing stem, count the stem plus "e" ("us" to "use").

- **The one-keystroke prefix "creat" ranks "Create account" only #3.**
  - **What:** while typing "create", "creat" ranks two other diagrams above "Create account". It is a prefix of "create" as it is of longer words ("creation", "created"), and is scored no better for being one letter short.
  - **Where:** `packages/core/src/search.ts` (prefix scoring).
  - **Why low:** one more keystroke ranks it first.
  - **Fix:** rank a prefix match by how much of the word it covers, so "creat" of "create" beats "creat" of "creation".

- **WebKit: Cmd-Z in the title field brings back stale text, and Enter saves it.**
  - **What:** after React sets the title field's value (a rename from an agent or another tab, or a revert), WebKit's native undo still holds the earlier typing. Cmd-Z shows that old text, and Enter commits it as the title.
  - **Where:** `apps/web/src/components/editor.tsx` (`TitleInput`).
  - **Why low:** WebKit only, and it needs an undo right after the value changed from elsewhere. The old title is in history, and undo of the title isn't promised.
  - **Fix:** clear the native undo stack when the value is set from outside (replace the field's value with `execCommand("insertText")` after selecting all, or remount the input).

- **Phones: a long tag pill can widen the page.**
  - **What:** `Pill` has `min-w-0` but also `shrink-0`, so a long unbroken tag name in the library's filter pill (or a card's) doesn't shrink and truncate; it can push the page wider than the screen.
  - **Where:** `apps/web/src/components/pill.tsx`, and its callers in `home.tsx` and `diagram-card.tsx`.
  - **Why low:** it needs a tag name too long for the phone's width; the page still scrolls to it.
  - **Fix:** drop `shrink-0` from the pill (keeping `min-w-0`), so it shrinks and truncates within its row, with `max-w-full` where it sits in a wrapping row.

## Refactors to consider (from the round 11 cleanup review)

- **What the preview shows, as one pure function.**
  - **What:** editor.tsx works out what the preview shows through separate ternaries: the latest, the last valid version, a past version that's loading, valid or invalid. That logic has been patched three times (33ec5c6, 544dd16, ada3949).
    - `lastValid` is a ref written during render.
    - The agent's preview label is built in `packages/webmcp`, so it can differ from `actorLabel`.
  - **Where:** `apps/web/src/components/editor.tsx:95-138`, `history-menu.tsx`, `packages/webmcp/src/index.ts:459-462`.
  - **Why low:** all preview states checked correct in round 11.
  - **Fix:** do this first if the logic needs another fix (cleanup #5).
    - Add `previewOf(latest, past)` in `lib/shown-version.ts`, with a unit-test matrix.
    - Store `actor` in `ui.preview`, and have the banner render it with `actorLabel`.

- **Theming baseline owned by theme.ts.**
  - **What:** the CSS pre-fill baseline is read from the live computed style.
    - Reset forces `applyTheme` first.
    - webmcp rebuilds the same rules on its own.
  - **Where:** `settings-dialog.tsx:73-91, 153-173`, `lib/webmcp.ts:51-57`, `lib/theme.ts`.
  - **Why low:** no live bug. Following an OS scheme change while Settings is open was rejected in R6 (S3).
  - **Fix:** add a synchronous `defaultAppCss(dark)` in theme.ts, which turns the override off and toggles `.dark` while it reads. Then `appCssShown` and `appCssToSave` serve both Settings and webmcp (cleanup #6). Run settings.spec in all three browsers.

- **One fit state in Preview.**
  - **What:** `fitting` and `fitCap` together describe one state and are written in three places, and the layout size is kept twice.
  - **Where:** `apps/web/src/components/preview.tsx`.
  - **Why low:** no live bug, and this is the owner's pan/zoom code.
  - **Fix:** use `fit: number | null` (the zoom cap while following the fit, or null once the person has moved it) and one size ref (cleanup #7). Add a test: resize while zoomed, then Fit.

- **One calendar-day count in grouping.ts.**
  - **What:** `dateBucket` and `relativeTime` each count calendar days their own way, and read the clock four times.
  - **Where:** `apps/web/src/lib/grouping.ts`.
  - **Why low:** I found no case where a card's age disagrees with its heading.
  - **Fix:** add one `daysAgo(ms, now)`, and have both functions take `now` (cleanup #8). Add a property test across a DST change and a year boundary.

- **Tag moves followed in one place.**
  - **What:** every caller of `renameTag` or `deleteTag` has to remember `followTag`, and webmcp re-normalises the paths itself.
  - **Where:** `apps/web/src/lib/router.ts:72-76`, `tag-tree.tsx` (the `followTag` calls after `renameTag` and `deleteTag`), `packages/webmcp/src/index.ts:409-412, 503-505`.
  - **Why low:** every current caller does it.
  - **Fix:** have `renameTag` and `deleteTag` return the normalised `{ from, to }` they applied, or null when nothing changed, and pass that to `followTag` (cleanup #9).

- **(Refactors) One line-ending rule.**
  - **What:** `packages/webmcp/src/index.ts` (update_diagram's echo compare) repeats core's private `lf()` regex.
  - **Where:** `packages/webmcp/src/index.ts:396`, `packages/core/src/store.ts` (`lf`).
  - **Why low:** it's one line, and it's correct today. It would only drift if core's normalisation changed.
  - **Fix:** the next time either is touched, have `editDiagram` report whether it merged anything (or export `lf`), and drop the copy.

- **`Eos.flushIndex` is public but only `saveNow` calls it.**
  - **Where:** `packages/core/src/store.ts` (`flushIndex`).
  - **Why low:** no live bug. It's one method on the public surface.
  - **Fix:** make it `private` the next time store.ts is touched.

- **caret.spec.ts reaches CodeMirror through an internal.**
  - **What:** `insertAt` finds the view through `.cm-content`'s `cmTile.root.view`, which `@codemirror/view` doesn't document (it's at `^6.43`). A minor update that renames it would fail about 50 caret tests on Chromium, and the 2 or 3 of the five every-engine checks that use it on Firefox and WebKit.
  - **Where:** `e2e/caret.spec.ts`, `insertAt`.
  - **Why low:** it's test-only, and it would fail loudly rather than pass wrongly.
  - **Fix:** dispatch a synthetic paste `ClipboardEvent` on `.cm-content`, which goes through the editor's real paste path, or expose the view on the element in dev builds only.

- **lineHunks's fallback is untested.**
  - **What:** no core test reaches `lineHunks`'s fallback when the changed lines have more distinct values than its one-character encoding allows (the `ids.size > 0xd800 - 0x100` return).
  - **Where:** `packages/core/src/store.ts:1155` (`lineHunks`) and `packages/core/src/store.test.ts`.
  - **Why low:** the round 19 auditors tested it by hand (a 55k-line fallback run) and it behaves correctly. Only regressions would go uncaught.
  - **Fix:** the next time the merge is touched, add a row: a two-line change among more than 55,000 distinct lines.

- **Dead code from earlier rounds.**
  - **What:** the Thumbnail `sourceText` fallback and `sourceText ?? sourcePreview`, the `sourcePreview` field, the unused `Result`/`ErrorCode` types, the unused `idb` dependency in `apps/web/package.json`, and `parseIds` duplicating `readDraggedIds`.
  - **Why low:** no behaviour; it's clutter.
  - **Fix:** remove them the next time those files are touched.
