type Child = Node | string | null | undefined | false

interface Props {
  class?: string
  text?: string
  attrs?: Record<string, string>
}

/** Tiny element builder. No virtual DOM: the overlay changes a handful of nodes. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (props?.class) el.className = props.class
  if (props?.text != null) el.textContent = props.text
  if (props?.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v)
  for (const c of children) if (c) el.append(c)
  return el
}

export const pad2 = (n: number): string => String(n).padStart(2, '0')

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches

export const wrap = (i: number, n: number): number => ((i % n) + n) % n

/** Restart a CSS animation on `el` by toggling `cls` across a forced reflow. */
export function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls)
  void el.offsetWidth
  el.classList.add(cls)
}
