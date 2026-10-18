/** A small card near the pointer or an element, drawn inside the map container. */
export class MapTooltip {
  private element: HTMLDivElement;

  constructor(private container: HTMLElement) {
    this.element = document.createElement("div");
    this.element.className = "aircraft-tooltip map-tooltip";
    this.element.setAttribute("role", "tooltip");
    this.element.hidden = true;
    container.appendChild(this.element);
  }

  /** Shows `html` above the point `x`, `y` (container pixels). */
  show(html: string, x: number, y: number, lift = 14) {
    this.element.innerHTML = html;
    this.element.hidden = false;
    const width = this.element.offsetWidth;
    const left = Math.min(Math.max(8, x - width / 2), Math.max(8, this.container.clientWidth - width - 8));
    this.element.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(4, y - lift - this.element.offsetHeight))}px)`;
  }

  /** Shows `html` above `target`. */
  showAbove(html: string, target: Element, lift = 6) {
    const box = target.getBoundingClientRect();
    const frame = this.container.getBoundingClientRect();
    this.show(html, box.left - frame.left + box.width / 2, box.top - frame.top, lift);
  }

  hide() { this.element.hidden = true; }

  destroy() { this.element.remove(); }
}

const tooltips = new WeakMap<HTMLElement, MapTooltip>();

/** The one tooltip of a map: only one thing is hovered at a time. */
export function sharedTooltip(container: HTMLElement): MapTooltip {
  let tooltip = tooltips.get(container);
  if (!tooltip) { tooltip = new MapTooltip(container); tooltips.set(container, tooltip); }
  return tooltip;
}
