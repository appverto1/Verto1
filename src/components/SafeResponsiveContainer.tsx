import React from 'react';
import { ResponsiveContainer } from 'recharts';

type SafeResponsiveContainerProps = {
  children: React.ReactNode;
  className?: string;
  minHeight?: number;
  minWidth?: number;
  width?: string | number;
  height?: string | number;
  skeletonClassName?: string;
};

export function SafeResponsiveContainer({
  children,
  className,
  minHeight = 300,
  minWidth = 0,
  width = '100%',
  height = '100%',
  skeletonClassName = 'h-full w-full rounded-2xl bg-slate-50 animate-pulse'
}: SafeResponsiveContainerProps) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;

    const check = () => {
      const w = node.offsetWidth || 0;
      const h = node.offsetHeight || minHeight;
      setReady(w > 0 && h > 0);
    };

    const rafId = window.requestAnimationFrame(check);
    const observer = new ResizeObserver(check);
    observer.observe(node);
    window.addEventListener('resize', check);

    return () => {
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [minHeight]);

  const wrapperStyle: React.CSSProperties = {
    minHeight,
    minWidth,
    width: typeof width === 'number' ? `${width}px` : width || '100%',
    height: typeof height === 'number' ? `${height}px` : height || '100%'
  };

  return (
    <div ref={wrapperRef} className={className} style={wrapperStyle}>
      {ready ? (
        <ResponsiveContainer width={width} height={height} minHeight={minHeight} minWidth={minWidth}>
          {children}
        </ResponsiveContainer>
      ) : (
        <div className={skeletonClassName} style={{ minHeight, minWidth }} />
      )}
    </div>
  );
}

