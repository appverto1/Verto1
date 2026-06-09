import React from 'react';

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
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;

    const check = () => {
      const rect = node.getBoundingClientRect();
      const measuredWidth = Math.floor(rect.width || node.clientWidth || node.offsetWidth || 0);
      const measuredHeight = Math.floor(rect.height || node.clientHeight || node.offsetHeight || minHeight || 0);
      const nextWidth = Math.max(0, measuredWidth);
      const nextHeight = Math.max(0, measuredHeight || minHeight);
      setSize((current) => (
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight }
      ));
    };

    const rafId = window.requestAnimationFrame(check);
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(check);
    });
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
  const ready = size.width > 0 && size.height > 0;
  const chart = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<any>, {
      width: size.width,
      height: size.height
    })
    : children;

  return (
    <div ref={wrapperRef} className={className} style={wrapperStyle}>
      {ready ? (
        chart
      ) : (
        <div className={skeletonClassName} style={{ minHeight, minWidth }} />
      )}
    </div>
  );
}

