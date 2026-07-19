import type {
  ButtonHTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from "react";

interface SnapLiquidSurfaceProps {
  children: ReactNode;
  className: string;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
}

interface SnapLiquidButtonSurfaceProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  className: string;
}

export function SnapLiquidSurface({
  children,
  className,
  onMouseDown,
}: SnapLiquidSurfaceProps) {
  return (
    <div className={`snap-liquid-surface ${className}`} onMouseDown={onMouseDown}>
      {children}
    </div>
  );
}

export function SnapLiquidButtonSurface({
  children,
  className,
  ...buttonProps
}: SnapLiquidButtonSurfaceProps) {
  return (
    <button className={`snap-liquid-surface ${className}`} {...buttonProps}>
      {children}
    </button>
  );
}
