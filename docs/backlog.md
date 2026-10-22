# Backlog

These are real issues that the audit loop judged below its bar. Each one is LOW: it isn't MEDIUM or worse, a regression, an accessibility failure or a false doc. They were deliberately left unfixed so the loop could converge.

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

- **The confirm dialog's close-focus guards aren't tested.**
  - **What:** in `onCloseAutoFocus`, each of these can be removed and all 22 confirm tests still pass in all three browsers: `!getUi().confirm?.open`, `document.activeElement === document.body`, and `e.preventDefault()`. The new dialog's focus trap seems to absorb the old one's late focus call. The abort guard `state.confirm?.id === entry.id` isn't tested either. Separately, `answerConfirm`'s comment gives a reason for closing before resolving that has no effect: promise callbacks run in a later microtask anyway.
  - **Where:** `apps/web/src/components/confirm-dialog.tsx`, `apps/web/src/lib/ui-state.ts` (`askConfirm`, `answerConfirm`), `e2e/confirm.spec.ts`.
  - **Why low:** behaviour is correct in every case checked. The guards are defensive.
  - **Fix:** add a test where an agent aborts after the person has answered and a second confirm is open (the second must stay open), plus one that moves focus elsewhere before the close. Otherwise drop the guards that can't be observed. Then trim `answerConfirm`'s comment to what the order actually does.

- **An Escape within a frame of an agent's confirm can close Settings instead.**
  - **What:** with Settings open, an Escape that lands within about 4 to 16 ms of an agent's confirm taking focus goes to Settings. Settings closes, and any unsaved Theming CSS goes with it. The confirm stays open. Radix works out `isHighestLayer` at render time, and Settings hasn't re-rendered yet. The same race could make the e2e test "Escape on an agent's confirm over Settings" flaky (it passed 6/6).
  - **Where:** `apps/web/src/components/settings-dialog.tsx` (DialogContent).
  - **Why low:** a person can't press a key within one frame of a dialog appearing.
  - **Fix:** `onEscapeKeyDown={(e) => getUi().confirm?.open && e.preventDefault()}` on Settings' DialogContent.

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
  - **Fix:** in `onKey`, return early when `getUi().settingsOpen || getUi().confirm?.open`, or when `e.target` is inside `[role=dialog], [role=alertdialog]`.

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
  - **What:** store.test.ts "hears every keystroke in a tab that opens the diagram while another tab's typing is being saved" checks after `settle()` (50 ms). Under heavy machine load (load average 57+) it failed 8/12 with 3 parallel processes. Its siblings that wait on another tab ("merges two tabs typing…", "starts a fresh burst…", "reads the rows once…") have the same pattern.
  - **Where:** `packages/core/src/store.test.ts:548-563` and the other `settle()` checks in that describe.
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
  - **What:** inside a dialog, `onEscape` (a window capture handler) calls `preventDefault()` so that Radix doesn't close Settings. CodeMirror then ignores the event, so its own Escape (`simplifySelection`) never runs. The selection stays, in all three engines.
  - **Where:** `apps/web/src/components/code-editor.tsx`, `onEscape`.
  - **Why low:** cosmetic. Escape then Tab still leaves the editor, and Settings stays open. Round 16 corrected the comment that claimed it collapses.
  - **Fix:** call `simplifySelection(v)` (from `@codemirror/commands`) in `onEscape` before arming the exit. Add an e2e: select text in the Diagram theme CSS editor, press Escape, and expect the selection to be empty and the dialog open.

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

- **In Settings, Safari's default Tab can't leave the last CSS editor, and WebKit's ⌥Tab doesn't wrap.**
  - **What:**
    - **The editor:** in WebKit, Escape then Tab in the Diagram theme CSS editor moves to the next text field. There is none, so Radix's trap sends focus back into the editor.
    - **⌥Tab:** on Close it doesn't wrap to the top, because Radix's loop ignores Tab with Alt held.
  - **Where:** `apps/web/src/components/settings-dialog.tsx` (DialogContent's focus scope).
  - **Why low:** it isn't a trap. Shift+Tab and ⌥Tab, Safari's standard key for every control, both work, and Escape closes Settings once focus is out of the editor.
  - **Fix:** none cheap. Wrapping on ⌥Tab would need a keydown handler on DialogContent that moves focus to the first or last tabbable when Alt+Tab leaves the ends.

- **A confirm focus-timing e2e test can fail under heavy parallel load.**
  - **What:** `e2e/confirm.spec.ts` "opened 50ms after the last confirm was answered, answered by Escape: focus goes back to the first one's opener" failed once in Firefox (1 of 1160 tests, 8 workers, all three engines at once). Run 5× on its own, it passed 110/110.
  - **Where:** `e2e/confirm.spec.ts`, the test named above.
  - **Why low:** test timing only. The product behaviour is unchanged.
  - **Fix:** if it recurs, wait for the first confirm to have closed (`toBeHidden`) instead of a fixed 50 ms before opening the second.

- **A heavy agent rewrite can drop what the person typed on the line it rewrites.**
  - **What:** in a `baseVersion` merge, when the agent deletes or rewrites the line the person has typed on since the base, the person's new characters can be lost (for example, base `x\n\t`, the person adds `#P#` after `x`, the agent rewrites the whole text). Both the jsdiff-based merge before round 16 and the Loro-based merge after it lose text in some of these cases, but in different ones. Round 16's fuzzing found the total number of clearly wrong merges went down. Since round 18 the merge diffs by lines, and since round 19 a line break belongs to the line it ends. So only what the person typed on a line the agent changes or removes (or moves, see below) can be lost, along with a whole line the person added between two lines the agent removes.
  - **Where:** `packages/core/src/store.ts`, `editsFromBase` and `diffText`.
  - **Why low:** the agent's deletion overlaps the person's edit, so there is no clearly right answer. The text is still in history, and the person can undo.
  - **Fix:** if wanted, keep insertions the person made inside a range the agent deletes, and place them after the agent's replacement.

- **Retrying an update_diagram with the same baseVersion applies the edit twice.**
  - **What:** an agent calls `update_diagram {source, baseVersion: v}`, then repeats the call unchanged, for example after a lost response, or after cancelling the call (execute doesn't stop on abort). The second call merges the diff from `v` again, on top of the first result. With base `graph TD\n  A --> B` and an added `  B --> C`, sending it twice gives `B --> C` twice.
  - **Where:** `packages/core/src/store.ts`, `editDiagram` (the `fromBase` branch).
  - **Why low:** the second call returns the merged `source`, which shows the duplicate, and agent undo reverts it. It only happens when an agent reuses a base it has already applied.
  - **Fix:** skip the merge when `edit.source === sourceOf(d)`: the text already is the agent's text, so the call is a no-op. Add a webmcp test that sends the same call twice and expects one copy.

- **Korean IME composition flashes "No diagrams match." more often since round 16.**
  - **What:** Hangul words are now matched exactly, so a syllable still being composed (`다이어그래` on the way to `다이어그램`) finds nothing. The library flashes its empty state mid-syllable, then shows the right results once the syllable is complete. It flashed at some states before round 16 too.
  - **Where:** `apps/web/src/components/home.tsx` (the Search input), `packages/core/src/search.ts`.
  - **Why low:** it's a brief flash during composition, and the final result is correct.
  - **Fix:** don't search while `e.nativeEvent.isComposing`, keeping the last results until `compositionend`.

- **Search doesn't treat curly and straight apostrophes, or hyphens and spaces, as the same.**
  - **What:** "don't" doesn't find a title typed as "don’t" (iOS smart punctuation), and "follow-up" doesn't find "Follow up". The query "don’t" also matches unrelated titles through the token "t". This predates round 16, since Orama's default splitter also kept `'` and `-`.
  - **Where:** `packages/core/src/search.ts`, the tokenizer.
  - **Why low:** the other words of the title still find it, and these are near misses rather than wrong results.
  - **Fix:** fold `’` and `‘` to `'` before tokenizing, and index a hyphenated or apostrophised word's parts as well as the whole word.

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
  - **Where:** `packages/core/src/store.ts`, `diffText` and `editsFromBase`.
  - **Why low:** which of two swapped lines "moved" is ambiguous. The text is in history, and agent undo reverts the move.
  - **Fix:** if wanted, in `editsFromBase`, treat a removed line that comes back unchanged elsewhere (unique in both texts) as a move. Insert the line's current text, from its start through its line break as mapped now, instead of the agent's copy.

- **A person's edit that deletes the line break an agent's edit is anchored on can join the agent's line onto theirs.**
  - **What:** with `baseVersion`, the person replaces the last line by deleting from the line break before it (`"\nL341"` becomes `"\nL342 …"`), and the agent adds a line above that last line. The agent's `"L343\n"` is anchored after the deleted line break, so the result is `"…L342 …L343\n"`. The r17 `r17merge` fuzzer at GAP=1 gives 14 of 452 such cases. They're identical before and after round 18.
  - **Where:** `packages/core/src/store.ts`, `editsFromBase` (a whole-line insertion after a deleted line break).
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

- **Dialog, sheet and menu animations ignore reduced motion.**
  - **What:** the Radix plus tw-animate enter and exit animations (100–200 ms fades, zoom-95, a 10-unit slide) run under `prefers-reduced-motion: reduce`. The app's own sidebar and preview animations respect it.
  - **Where:** `packages/ui` components (dialog, sheet, popover, dropdown).
  - **Why low:** they're short and small. This is WCAG 2.3.3, which is AAA.
  - **Fix:** add `motion-reduce:animate-none` (or a global `@media (prefers-reduced-motion: reduce)` rule zeroing `animation-duration`) to those components.

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

## Refactors to consider (from the round 11 cleanup review)

- **What the preview shows, as one pure function.**
  - **What:** editor.tsx works out what the preview shows through separate ternaries: the latest, the last valid version, a past version that's loading, valid or invalid. That logic has been patched three times (33ec5c6, 544dd16, ada3949).
    - `lastValid` is a ref written during render.
    - `previewSource` isn't tied to a version, so switching between two past versions briefly shows the first one's text under the second one's banner. Found by reading the code; it lasts one tick.
    - The agent's preview label is built in `packages/webmcp`, so it can differ from `actorLabel`.
  - **Where:** `apps/web/src/components/editor.tsx:95-138`, `history-menu.tsx`, `packages/webmcp/src/index.ts:459-462`.
  - **Why low:** all preview states checked correct in round 11.
  - **Fix:** do this first if the logic needs another fix (cleanup #5).
    - Add `previewOf(latest, past)` in `lib/shown-version.ts`, with a unit-test matrix.
    - Key the fetched text by version.
    - Store `actor` in `ui.preview`, and have the banner render it with `actorLabel`.

- **Theming baseline owned by theme.ts.**
  - **What:** the CSS pre-fill baseline is read from the live computed style.
    - It waits on a 0 ms timer after a mode change.
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

- **Escape's tab-focus arming lives in two places.**
  - **What:** the Escape keymap entry and the dialog-only window handler `onEscape` both call `setTabFocusMode(2000)`.
  - **Where:** `apps/web/src/components/code-editor.tsx`.
  - **Why low:** both are correct. Merging them saves about 3 lines.
  - **Fix:** the next time Escape handling changes (for example the selection-collapse fix above):
    - let `onEscape` arm the exit whenever the editor has focus, and keep `preventDefault()` (plus `simplifySelection`) only in a dialog;
    - drop the keymap entry;
    - run the two Escape tests and accessibility.spec in all three browsers.

- **caret.spec.ts reaches CodeMirror through an internal.**
  - **What:** `insertAt` finds the view through `.cm-content`'s `cmTile.root.view`, which `@codemirror/view` doesn't document (it's at `^6.43`). A minor update that renames it would fail about 50 caret tests on Chromium, and the 2 or 3 of the five every-engine checks that use it on Firefox and WebKit.
  - **Where:** `e2e/caret.spec.ts`, `insertAt`.
  - **Why low:** it's test-only, and it would fail loudly rather than pass wrongly.
  - **Fix:** dispatch a synthetic paste `ClipboardEvent` on `.cm-content`, which goes through the editor's real paste path, or expose the view on the element in dev builds only.

- **Two branches of diffText are untested.**
  - **What:** no core test reaches two things:
    - `lineHunks`'s fallback when the changed lines have more distinct values than its one-character encoding allows (the `ids.size > 0xd800 - 0x100` return);
    - the `/\S/` check in `diffText` that decides whether an inserted "extends then adds" text is split.
  - **Where:** `packages/core/src/store.ts` (`lineHunks`, `diffText`) and `packages/core/src/store.test.ts`.
  - **Why low:** the round 19 auditors tested each branch by hand (a 55k-line fallback run, the exactness fuzz) and they behave correctly. Only regressions would go uncaught.
  - **Fix:** the next time the merge is touched, add two rows: a two-line change among more than 55,000 distinct lines, and an insertion at the end of a whitespace-only line.
