import React from 'react';
import { ResponsiveContainer } from 'recharts';

type SafeResponsiveContainerProps = {
  children: React.ReactNode;
  className?: string;
  minHeight?: number;
  minWidth?: number;
  width?: string | number;
  height?: string | number;
};

export function SafeResponsiveContainer({
  children,
  className,
  minHeight = 300,
  minWidth = 0,
  width = '100%',
  height = '100%'
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

    check();
    const observer = new ResizeObserver(check);
    observer.observe(node);
    window.addEventListener('resize', check);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [minHeight]);

  return (
    <div ref={wrapperRef} className={className} style={{ minHeight, minWidth }}>
      {ready ? (
        <ResponsiveContainer width={width} height={height} minHeight={minHeight} minWidth={minWidth}>
          {children}
        </ResponsiveContainer>
      ) : (
        <div style={{ minHeight, minWidth }} />
      )}
    </div>
  );
}

