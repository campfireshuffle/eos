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
  - **Where:** `packages/core/src/store.ts:530`. Callers: `set_theme` in `packages/webmcp/src/index.ts`, which casts `as never`; Settings' Save, which spreads the rendered theme in first; and `importBackup`, which spreads `settingsCache.theme` in first.
  - **Why low:** behaviour is correct, and every caller works around the type.
  - **Fix:** type the parameter `{ theme?: Partial<AppSettings["theme"]>; agent?: Partial<AppSettings["agent"]> }`, then drop the cast and the two spreads.

- **Settings › MCP: the chrome:// addresses break at their own hyphens on phones.**
  - **What:** at 320 to 390px, the addresses break as `#enable-` ⏎ `webmcp-testing` and `#remote-` ⏎ `debugging`. That contradicts the comment "Wrap only after a / or #".
  - **Where:** `apps/web/src/components/settings-dialog.tsx`, `ChromeUrl`.
  - **Why low:** cosmetic, and the copy button gives the exact address.
  - **Fix:** wrap each part in `<span className="whitespace-nowrap">`, keep the `<wbr />` between parts, and drop `[overflow-wrap:anywhere]` if it's no longer needed.

- **Diagrams already saved with CRLF line endings.**
  - **What:** round 11 normalises line endings when a source enters core, and the editor breaks lines only at `\n`, so what it shows and what's stored stay in step. A diagram an agent wrote with `\r\n` before that fix still holds its `\r`s, and so does one brought back from a backup or an old version. Each `\r` shows as a ␍ marker at the end of its line until it's edited away. End puts the caret after the marker, so text typed there leaves a lone `\r` mid-line. Pele counts that as a line break and the editor doesn't, so the preview splits the line there, and an error on any later line is reported and highlighted one line too low.
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
  - **Where:** `apps/web/src/lib/router.ts:72-76`, `tag-tree.tsx:57, 213`, `packages/webmcp/src/index.ts:409-412, 503-505`.
  - **Why low:** every current caller does it.
  - **Fix:** have `renameTag` and `deleteTag` return the normalised `{ from, to }` they applied, or null when nothing changed, and pass that to `followTag` (cleanup #9).
