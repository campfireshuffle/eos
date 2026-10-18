# Eos

A local-first Mermaid editor. Diagrams render with [Pele](https://pele.run), live in your browser's IndexedDB, and can be driven by AI agents over [WebMCP](https://github.com/webmachinelearning/webmcp).

**[eos.lil.run](https://eos.lil.run)**

- **Local-first.** No account, no server. Each diagram is a [Loro](https://loro.dev) CRDT document persisted to IndexedDB, synced across tabs, with undo/redo and history.
- **Fast previews.** Pele renders every library thumbnail and the editor preview live.
- **Agent-ready.** Every action in the UI is also a WebMCP tool, so an agent can do anything you can. Destructive tools ask you first.
- **Themeable.** Paste CSS variables in Settings › Theming.

## Layout

```
apps/web          Vite + React app, deployed to Cloudflare (Workers static assets)
packages/core     Data layer: Loro docs, IndexedDB, library queries, share links
packages/webmcp   WebMCP tool definitions over the core API
packages/ui       shadcn/ui components
docs/             Design notes (data model, WebMCP tools)
```

## Develop

Requires Node 22.13+ and pnpm 12.

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm test
pnpm typecheck
pnpm build
```

Add shadcn components with `pnpm dlx shadcn@latest add <name> -c apps/web`.

## Deploy

```sh
pnpm --filter @eos/web exec wrangler login   # once
pnpm deploy
```

`apps/web/wrangler.jsonc` serves `dist/` as a single-page app on the `eos.lil.run` custom domain.

## Credits

Built on [Pele](https://github.com/obsidianmd/pele) by kepano (MIT), [Loro](https://loro.dev), [CodeMirror](https://codemirror.net), [shadcn/ui](https://ui.shadcn.com) and [Lucide](https://lucide.dev).

## License

MIT
