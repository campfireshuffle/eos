# Theming

Eos is themed with CSS variables. Open **Settings › Theming** to change them.

## Where it's saved

Your mode and both CSS overrides are saved in this browser, in the same IndexedDB database as your diagrams. They:

- persist across reloads and restarts,
- apply right away in your other open Eos tabs,
- are included in backups (**Settings › Storage › Export backup**),
- aren't shared with other browsers or devices.

**Reset to default** removes both overrides. The light/dark choice is also copied to `localStorage` so the page opens in the right mode without a flash.

## Mode

**Light**, **Dark** or **System** (follows your operating system).

## App theme

App CSS is a list of variable declarations. Only declarations are kept: selectors, `@` rules and anything that isn't a `--` variable are ignored, as are values that could load something (`url(`, `image-set(` and the like, or any backslash escape). Each declaration overrides that variable in **both** light and dark mode, so a colour you set while in dark mode also applies in light mode. The editor starts with the current mode's values, and **Save** keeps only the ones you changed, so the rest still follow the mode.

```css
:root {
  --eos-champagne: #7fb3a3;
}
```

| Variable                  | Used for                                      | Light     | Dark      |
| ------------------------- | --------------------------------------------- | --------- | --------- |
| `--eos-ink`               | Page background                               | `#f1f0ec` | `#0e0e0e` |
| `--eos-panel`             | Panes, cards, menus                           | `#ffffff` | `#191919` |
| `--eos-raised`            | Hover and selected rows, inputs               | `#e9e7e2` | `#242424` |
| `--eos-line`              | Borders and dividers                          | `#dddad3` | `#262626` |
| `--eos-line-hover`        | Borders on hover                              | `#cbc7bf` | `#313131` |
| `--eos-line-active`       | Strong borders                                | `#aeaaa1` | `#3d3d3d` |
| `--eos-body`              | Main text                                     | `#141413` | `#ebeae6` |
| `--eos-muted`             | Secondary text, focus rings                   | `#57564f` | `#a3a3a0` |
| `--eos-faint`             | Hints, line numbers                           | `#696760` | `#8f8f8c` |
| `--eos-primary`           | Primary buttons                               | `#141413` | `#fcf4e4` |
| `--eos-on-primary`        | Text on primary buttons                       | `#fcf4e4` | `#0e0e0e` |
| `--eos-champagne`         | Accent: stars, selection, drop targets, links | `#85652a` | `#e6cc9c` |
| `--eos-red`               | Errors and delete actions                     | `#b3261e` | `#ec8b7f` |
| `--eos-green`             | Success, "Valid"                              | `#4f6b0a` | `#879a39` |
| `--eos-selection`         | Selected text in the editor                   | `#cbc7bf` | `#3d3d3d` |
| `--eos-syntax-keyword`    | Mermaid keywords                              | `#7a5a1c` | `#e6cc9c` |
| `--eos-syntax-string`     | Strings and labels                            | `#4b6612` | `#b9c59a` |
| `--eos-syntax-property`   | Properties                                    | `#964b1f` | `#d9a684` |
| `--eos-syntax-definition` | Node and type names                           | `#1f5c92` | `#9fb6d9` |
| `--eos-syntax-number`     | Numbers                                       | `#6d3f92` | `#c7a6d9` |
| `--eos-syntax-comment`    | Comments                                      | `#706e66` | `#858583` |

Text sizes are variables too. Each size but the code size has a matching `--eos-lh-*` line height, a fixed px value that doesn't follow the size, so override both together or wrapped lines overlap. The editor's line height is a ratio of the code size, so that one can change alone.

| Size               | Line height        | Used for                         | Desktop     | Phones      |
| ------------------ | ------------------ | -------------------------------- | ----------- | ----------- |
| `--eos-fs-caption` | `--eos-lh-caption` | Captions, section labels, counts | 12px / 16px | 13px / 18px |
| `--eos-fs-body`    | `--eos-lh-body`    | Body text, and labels at 500     | 14px / 20px | 16px / 22px |
| `--eos-fs-title`   | `--eos-lh-title`   | Titles                           | 15px / 20px | 17px / 22px |
| `--eos-fs-heading` | `--eos-lh-heading` | Headings                         | 18px / 24px | 20px / 26px |
| `--eos-fs-code`    | (1.72 × the size)  | The source editor                | 13px        | 16px        |

Body and label text also share `--eos-ls-body`, their letter spacing (-0.006em on desktop, -0.011em on phones). Phones here means screens under 768px wide, or touch screens without hover.

## Diagram theme

Diagram CSS sets [Pele](https://pele.run)'s variables. Only `--pele-` declarations are kept. By default they follow the app theme:

```css
.pele {
  --pele-fg: var(--eos-body);
  --pele-line: var(--eos-muted);
  --pele-surface: var(--eos-raised);
  --pele-border: var(--eos-line-active);
  --pele-accent: var(--eos-champagne);
  --pele-radius: 6px;
}
```

Other variables Pele reads include `--pele-bg`, `--pele-muted`, `--pele-surface-alt`, `--pele-error`, `--pele-critical`, `--pele-font` and `--pele-font-mono`. See [Pele's theming docs](https://pele.run/theming) for the full list and what each one colours.

Diagram CSS changes the preview, library thumbnails and SVG/PNG exports.

## From an agent

Agents can read the theme in effect with `get_settings` and change it with `set_theme` (see [data-model.md](data-model.md#10-webmcp-tools)).
