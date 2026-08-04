"use client";

/**
 * Free-text field that is never re-controlled while the user types.
 *
 * A controlled `<input value={state}>` makes React write the value back into
 * the DOM node on re-render. On Android that invalidates Gboard's cached
 * cursor / surrounding-text model, and the next committed word can land at
 * offset 0 — which reverses word order one word at a time. Seeding the node
 * with `defaultValue` and only mirroring changes *out* into React state keeps
 * the IME's model intact.
 *
 * Because `defaultValue` is applied at mount only, callers rendering these in
 * a list must use stable keys — index keys would leave a removed row's text
 * behind in the reused DOM node.
 */
export function TextField({
  value,
  onValueChange,
  ...rest
}: Omit<React.ComponentPropsWithoutRef<"input">, "value" | "onChange"> & {
  value: string;
  onValueChange: (next: string) => void;
}) {
  return (
    <input
      type="text"
      defaultValue={value}
      onChange={(e) => onValueChange(e.target.value)}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      {...rest}
    />
  );
}
