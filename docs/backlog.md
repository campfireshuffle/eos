# Backlog

These are real issues that the audit loop judged below its bar. Each one is LOW: it isn't MEDIUM or worse, a regression, an accessibility failure or a false doc. They were deliberately left unfixed so the loop could converge.

Each entry says what the issue is, where it is, why it's low, and a suggested fix. The first part lists defects. The second lists refactors from the round 11 cleanup review: each is worth doing the next time its code needs a fix, rather than patching that code again.

## Defects

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
  - **What:** round 11 normalises line endings when a source enters core. A diagram an agent wrote with `\r\n` before that fix still has it, and its editor stays out of step with the stored text.
  - **Where:** `packages/core/src/store.ts` (opening a diagram), or the editor binding.
  - **Why low:** only agent-created diagrams from before the fix can be affected, and most likely none exist.
  - **Fix:** if one turns up, normalise the text once when the diagram opens, as a system change.

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
