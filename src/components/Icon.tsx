import type { SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "viewBox"> {
  size?: number;
}

/** Builds a solid, currentColor icon that scales to its box like a glyph. */
export function createIcon(name: string, viewBox: string, paths: string[]) {
  function Icon({ size = 16, className, ...props }: IconProps) {
    // Solid glyphs fill their whole box; drawing them a touch smaller keeps
    // the same optical weight the stroke icons had at each call-site size.
    const drawn = Math.round(size * 0.86);
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={viewBox}
        width={drawn}
        height={drawn}
        fill="currentColor"
        aria-hidden={props["aria-label"] ? undefined : true}
        focusable="false"
        className={className ? `icon ${className}` : "icon"}
        {...props}
      >
        {paths.map((d) => <path key={d.slice(0, 24)} d={d} />)}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}
