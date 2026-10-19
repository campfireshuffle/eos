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

App CSS is a list of variable declarations. Only declarations are kept: selectors, `@` rules and anything that isn't a `--` variable are ignored. Each declaration overrides that variable in **both** light and dark mode, so a colour you set while in dark mode also applies in light mode.

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
| `--eos-line-active`       | Focus rings, strong borders                   | `#aeaaa1` | `#3d3d3d` |
| `--eos-body`              | Main text                                     | `#141413` | `#ebeae6` |
| `--eos-muted`             | Secondary text                                | `#57564f` | `#8b8b88` |
| `--eos-faint`             | Counts, hints, line numbers                   | `#87857e` | `#5a5a58` |
| `--eos-primary`           | Primary buttons                               | `#141413` | `#fcf4e4` |
| `--eos-on-primary`        | Text on primary buttons                       | `#fcf4e4` | `#0e0e0e` |
| `--eos-champagne`         | Accent: stars, selection, drop targets, links | `#85652a` | `#e6cc9c` |
| `--eos-red`               | Errors and delete actions                     | `#b3261e` | `#d14d41` |
| `--eos-green`             | Success, "Valid"                              | `#4f6b0a` | `#879a39` |
| `--eos-selection`         | Selected text in the editor                   | `#cbc7bf` | `#3d3d3d` |
| `--eos-syntax-keyword`    | Mermaid keywords                              | `#7a5a1c` | `#e6cc9c` |
| `--eos-syntax-string`     | Strings and labels                            | `#4b6612` | `#b9c59a` |
| `--eos-syntax-property`   | Properties                                    | `#964b1f` | `#d9a684` |
| `--eos-syntax-definition` | Node and type names                           | `#1f5c92` | `#9fb6d9` |
| `--eos-syntax-number`     | Numbers                                       | `#6d3f92` | `#c7a6d9` |
| `--eos-syntax-comment`    | Comments                                      | `#8a887f` | `#6b6b69` |

Text sizes are variables too: `--eos-fs-caption`, `--eos-fs-body`, `--eos-fs-title` and `--eos-fs-heading` (12, 13, 15 and 18px on desktop; one step larger on phones).

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
