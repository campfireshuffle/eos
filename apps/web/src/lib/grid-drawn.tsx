import { useLayoutEffect, type ComponentProps } from "react"
import type { GridListProps, GridListRenderProps, Key } from "react-aria-components"

type Collection = GridListRenderProps["state"]["collection"]

/**
 * Says when a GridList has drawn `keys`: its items are exactly these, in this order. A GridList draws the items it's
 * handed in a render after it's handed them, so until then it still shows the ones before. Returns the GridList's
 * render prop.
 *
 * Invariant: `onDrawn` runs, before paint, in each commit in which the grid's items are `keys` and either they or
 * `onDrawn` changed. So a new `onDrawn` asks again of the grid as it is.
 */
export function useGridDrawn(keys: Key[], onDrawn: () => void): NonNullable<GridListProps<object>["render"]> {
  return (props, { state }) => <DrawnGrid {...props} collection={state.collection} keys={keys} onDrawn={onDrawn} />
}

function DrawnGrid({
  collection,
  keys,
  onDrawn,
  ...props
}: ComponentProps<"div"> & { collection: Collection; keys: Key[]; onDrawn: () => void }) {
  useLayoutEffect(() => {
    if (sameItems(collection, keys)) onDrawn()
  }, [collection, keys, onDrawn])
  return <div {...props} />
}

function sameItems(collection: Collection, keys: Key[]) {
  if (collection.size !== keys.length) return false
  let i = 0
  for (let k = collection.getFirstKey(); k != null; k = collection.getKeyAfter(k))
    if (collection.getItem(k)?.type === "item" && k !== keys[i++]) return false
  return i === keys.length
}
