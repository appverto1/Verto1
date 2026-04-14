import React, { useRef, useEffect, useState } from 'react';
import { Pencil, Eraser, Check, X, RotateCcw } from 'lucide-react';

interface DrawingCanvasProps {
  image: string;
  onSave: (editedImage: string) => void;
  onCancel: () => void;
}

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ image, onSave, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#FF0000');
  const [lineWidth, setLineWidth] = useState(4);
  const [tool, setTool] = useState<'pencil' | 'eraser'>('pencil');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const loadImage = async () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';

      try {
        const resp = await fetch(image);
        const blob = await resp.blob();
        const localUrl = URL.createObjectURL(blob);
        objectUrlRef.current = localUrl;
        img.src = localUrl;
      } catch {
        img.src = image;
      }

      img.onload = () => {
        baseImageRef.current = img;
        const containerWidth = containerRef.current?.clientWidth || window.innerWidth;
        const containerHeight = (window.innerHeight * 0.6);
        
        let width = img.width;
        let height = img.height;
        
        const ratio = Math.min(containerWidth / width, containerHeight / height);
        width *= ratio;
        height *= ratio;

        canvas.width = width;
        canvas.height = height;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      };
    };
    loadImage();

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [image]);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    let x = 0;
    let y = 0;
    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }
    lastPointRef.current = { x, y };
    draw(e);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    lastPointRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.beginPath();
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let x, y;

    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

    if (tool === 'eraser') {
      const baseImage = baseImageRef.current;
      if (!baseImage) return;
      const radius = Math.max(8, lineWidth * 2);
      const sx = Math.max(0, x - radius);
      const sy = Math.max(0, y - radius);
      const sw = Math.min(canvas.width - sx, radius * 2);
      const sh = Math.min(canvas.height - sy, radius * 2);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(baseImage, sx, sy, sw, sh, sx, sy, sw, sh);
      ctx.restore();
      lastPointRef.current = { x, y };
      return;
    }

    const from = lastPointRef.current || { x, y };
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastPointRef.current = { x, y };
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        onSave(canvas.toDataURL('image/png'));
      } catch (error) {
        console.error('Drawing save error:', error);
        onSave(image);
      }
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = baseImageRef.current;
    if (!img) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl flex flex-col h-full">
        <div className="flex justify-between items-center mb-4 text-white">
          <h3 className="font-bold">Rabisco Criativo</h3>
          <div className="flex gap-2">
            <button onClick={onCancel} className="p-2 bg-white/10 rounded-full hover:bg-white/20">
              <X size={20} />
            </button>
          </div>
        </div>

        <div ref={containerRef} className="flex-1 flex items-center justify-center bg-white/5 rounded-3xl overflow-hidden relative">
          <canvas
            ref={canvasRef}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseOut={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            className="max-w-full max-h-full cursor-crosshair touch-none"
          />
        </div>

        <div className="mt-6 bg-white/10 backdrop-blur-md p-4 rounded-[32px] flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-2">
              <button 
                onClick={() => setTool('pencil')}
                className={`p-3 rounded-2xl transition-all ${tool === 'pencil' ? 'bg-[#7a32fc] text-white' : 'bg-white/10 text-white'}`}
              >
                <Pencil size={20} />
              </button>
              <button 
                onClick={() => setTool('eraser')}
                className={`p-3 rounded-2xl transition-all ${tool === 'eraser' ? 'bg-[#7a32fc] text-white' : 'bg-white/10 text-white'}`}
              >
                <Eraser size={20} />
              </button>
              <button 
                onClick={clearCanvas}
                className="p-3 rounded-2xl bg-white/10 text-white hover:bg-white/20"
              >
                <RotateCcw size={20} />
              </button>
            </div>

            <div className="flex gap-2">
              {['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#000000'].map(c => (
                <button
                  key={c}
                  onClick={() => { setColor(c); setTool('pencil'); }}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${color === c && tool === 'pencil' ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <button 
            onClick={handleSave}
            className="w-full bg-[#05CD99] text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-green-500/20"
          >
            <Check size={20} /> Pronto! Usar esta foto
          </button>
        </div>
      </div>
    </div>
  );
};
