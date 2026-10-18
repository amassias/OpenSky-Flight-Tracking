import { useEffect, useRef, type MutableRefObject } from "react";
import type { Marker } from "maplibre-gl";
import type { MapHandle } from "./mapHandle";

export interface DomMarkerEvents {
  mousedown?: (event: MouseEvent) => void;
  click?: (event: MouseEvent) => void;
  mouseover?: (event: MouseEvent) => void;
  mouseout?: (event: MouseEvent) => void;
}

export interface DomMarkerOptions {
  handle: MapHandle;
  /** [latitude, longitude]. Only the first value matters for markers that are moved with `setLngLat`. */
  position: [number, number];
  className: string;
  html: string;
  /** Width and height in CSS pixels; the marker is centred on its position. */
  size: number;
  zIndex?: number;
  /** Native tooltip. A button without `label` is named by its content. */
  title?: string;
  /** Accessible name, when the content does not already give one. */
  label?: string;
  /** A button the keyboard can reach (Enter and Space activate it). */
  interactive?: boolean;
  events?: DomMarkerEvents;
}

/**
 * A DOM element pinned to a map position. It is made once; a new `html` or
 * `className` rewrites the element in place, so its position and listeners survive.
 */
export function useDomMarker({ handle, position, className, html, size, zIndex, title, label, interactive = true, events }: DomMarkerOptions): { markerRef: MutableRefObject<Marker | null>; elementRef: MutableRefObject<HTMLElement | null> } {
  const markerRef = useRef<Marker | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const firstPosition = useRef(position);

  useEffect(() => {
    const element = document.createElement("div");
    element.style.width = element.style.height = `${size}px`;
    const forward = (type: keyof DomMarkerEvents) => (event: Event) => eventsRef.current?.[type]?.(event as MouseEvent);
    for (const type of ["mousedown", "click", "mouseover", "mouseout"] as const) element.addEventListener(type, forward(type));
    // A map button is reachable from the keyboard like any other button.
    const activate = (event: KeyboardEvent) => {
      if (event.target === element && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); element.click(); }
    };
    element.addEventListener("keydown", activate);
    const [latitude, longitude] = firstPosition.current;
    const marker = new handle.gl.Marker({ element, anchor: "center" }).setLngLat([longitude, latitude]).addTo(handle.map);
    markerRef.current = marker;
    elementRef.current = element;
    return () => {
      marker.remove();
      markerRef.current = null;
      elementRef.current = null;
    };
    // The size is fixed for the life of a marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  const appliedClass = useRef<string[]>([]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    // MapLibre owns some classes of the element (marker, anchor, occlusion): only ours are swapped.
    element.classList.remove(...appliedClass.current);
    appliedClass.current = className.split(" ").filter(Boolean);
    element.classList.add(...appliedClass.current);
    element.innerHTML = html;
  }, [className, html]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (zIndex != null) element.style.zIndex = String(zIndex);
    if (title != null) element.title = title;
    // MapLibre names every marker "Map marker"; a marker without a label is named by its content instead.
    if (label != null) element.setAttribute("aria-label", label);
    else element.removeAttribute("aria-label");
    if (interactive) { element.tabIndex = 0; element.setAttribute("role", "button"); }
    else { element.removeAttribute("tabindex"); element.removeAttribute("role"); element.setAttribute("aria-hidden", "true"); }
  }, [zIndex, title, label, interactive, className, html]);

  const [latitude, longitude] = position;
  useEffect(() => {
    markerRef.current?.setLngLat([longitude, latitude]);
  }, [latitude, longitude]);

  return { markerRef, elementRef };
}
