/** Seeded into an empty library so the first visit isn't blank. */
export const SAMPLES: { title: string; source: string; tags: string[] }[] = [
  {
    title: "Welcome to Eos",
    tags: ["examples"],
    source: `flowchart LR
  A([Write Mermaid]) --> B[Pele renders]
  B --> C[(Saved locally)]
  C --> D{Share?}
  D -- Link --> E[Copy link]
  D -- File --> F[Export]
`,
  },
]
