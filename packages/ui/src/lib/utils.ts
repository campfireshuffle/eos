import { createCn } from "cn/config"

/** Class merging that knows Eos's type scale (text-caption/body/title/heading) are font sizes, not colors. */
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["caption", "body", "title", "heading"] }] } },
})
