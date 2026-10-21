# Eos launch video

The launch video for Eos: a 29.3 s, 4:5 seamless loop showing the library, an agent drawing a diagram through WebMCP, and the version and share panels.

| File | Size | Use |
| --- | --- | --- |
| `eos-launch-2160x2700.mp4` | 2160×2700, 12 MB | Portfolio master. Upload this one natively to X (Premium accounts can post 4K; X downscales otherwise). |
| `eos-launch-1080x1350.mp4` | 1080×1350, 4.4 MB | Standard 4:5 social size, downscaled from the master. For Bluesky, LinkedIn and previews. |
| `eos-launch-score.wav` | 48 kHz, 16-bit | The score on its own ("Rewind 90", round r31). |

Both videos: 30 fps, H.264 High, BT.709 TV range, AAC 256 kbps, −12.8 LUFS integrated, −1.2 dBFS peak. The last frame matches the first, so the loop has no seam.

## Storyboard

Times are seconds into the loop. The score is 90 BPM, so one bar is 2.667 s and one beat is 0.667 s.

| Time | Picture | Sound |
| --- | --- | --- |
| 0–1.9 | The Eos library, alone on a paper background. | Dmaj9 bed, light groove. |
| 1.9–2.3 | A Claude Code window (Ghostty style, v2.1.304) fades in over Eos. The pointer arrives with it. | |
| 2.6 | The pointer clicks into Claude's prompt; it hides while typing. | Click bloop. |
| 2.75–4.35 | Typing: "map how a request reaches our api". Enter at 4.8. | |
| 4.9 | The agent creates a new, empty diagram and opens it ("Called eos 1 time"). | |
| 5.0–5.22 | The agent folds the sidebar away (`set_view sidebarOpen: false`). | |
| 5.333–7.667 | The flowchart draws itself box by box, one box per eighth note. Eos re-centres each box; a glide hides the jump. | The eight reversed "box notes". |
| ~7.97 | Claude: "Mapped it: request → edge → auth → API → cache/database → response." | |
| 10.9–12.6 | Typing: "give it a dawn palette". | |
| 13.333 | The diagram takes on the dawn palette (0.3 s crossfade). | The wash: a big reversed Amaj9 swell, pad opens. |
| 14.05–15.55 | Typing: "make it a sequence diagram". | |
| 16.0 | The diagram becomes a sequence diagram with dawn-coloured step bands (0.35 s crossfade). | Gmaj9 bar. |
| 18.667 | Claude fades out; the camera pushes in to 1.5× on the version panel. | |
| 19.267 | Click: Version history opens (three Agent entries). | Click bloop. |
| 20.267 | Click: the oldest version previews, grey. | Click bloop. |
| 20.6–21.7 | A slow, level pan right along the header. | |
| 22.0 | Click: Export opens the share menu; the pointer rests on "Copy share link". | Click bloop. |
| 23.35 | The menu closes (Escape). | |
| 23.36–24.0 | | The stop: the band drops out, a low reversed inhale. |
| 23.47–25.07 | The camera pushes back out to the full window. | 24.0: the snap, everything slams back in. |
| 24.2–25.0 | The pointer heads for the header's Back arrow as it comes into view, and rests there. | The ladder: notes timed to the push-out. |
| 25.4 | Click: back to the library, with the new Request path card first. | Click bloop. |
| 26.667–29.333 | The library holds. | Held A9sus; the bass climbs A, B, C# and lands on a long D at 28.0, which rings into the loop's Dmaj9. |
| 28.933–29.333 | Crossfade back to the opening library. | |

## Posting notes

- Post the video natively on x.com or the X iOS app. Tools that post through the X API (Typefully included) are reported to cap video at 720p.
- Copy (tweet option 1): "eos: a local-first mermaid editor. diagrams render instantly with pele by @kepano, and your agent can draw them too". Reply: "eos.lil.run · no account, everything stays in your browser · open source".

## How it was made

Everything on screen is the real app at eos.lil.run, captured with Playwright at 4× pixel density. Every agent action is a real WebMCP tool call (`create_diagram`, `update_diagram`, `set_view`). A small HTML compositor arranges the captures with the terminal, pointer and camera, and is rendered frame by frame. The score was synthesised in Python by a composer subagent over 31 rounds. The full process, tools and lessons are in the `video-demo-creation` skill in Sarim's dotfiles (`~/doot/agents/.agents/skills/video-demo-creation`).
