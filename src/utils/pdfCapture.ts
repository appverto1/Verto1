const imageDataUrlCache = new Map<string, string>();

const shouldInlineImage = (src: string) => {
  const normalized = String(src || "").trim();
  if (!normalized) return false;
  if (normalized.startsWith("data:") || normalized.startsWith("blob:")) return false;
  return /^https?:\/\//i.test(normalized);
};

export const convertImageUrlToDataUrl = async (src: string): Promise<string | null> => {
  const normalized = String(src || "").trim();
  if (!shouldInlineImage(normalized)) return normalized || null;
  if (imageDataUrlCache.has(normalized)) {
    return imageDataUrlCache.get(normalized) || null;
  }

  try {
    const response = await fetch(normalized, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "force-cache",
    });
    if (!response.ok) {
      throw new Error(`Falha ao carregar imagem (${response.status})`);
    }

    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha ao converter imagem para base64."));
      reader.readAsDataURL(blob);
    });

    imageDataUrlCache.set(normalized, dataUrl);
    return dataUrl;
  } catch (error) {
    console.warn("Não foi possível converter imagem para base64 antes do PDF:", error);
    return normalized;
  }
};

export const prepareElementForPdfCapture = async (source: HTMLElement): Promise<HTMLElement> => {
  const clone = source.cloneNode(true) as HTMLElement;
  const sourceRect = source.getBoundingClientRect();

  clone.style.position = "fixed";
  clone.style.left = "-10000px";
  clone.style.top = "0";
  clone.style.width = `${Math.max(source.scrollWidth, Math.round(sourceRect.width), 794)}px`;
  clone.style.maxWidth = "none";
  clone.style.zIndex = "-1";
  clone.style.pointerEvents = "none";
  clone.style.opacity = "1";

  document.body.appendChild(clone);

  const images = Array.from(clone.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src") || "";
      const nextSrc = await convertImageUrlToDataUrl(src);
      if (nextSrc) {
        img.setAttribute("src", nextSrc);
      }
      img.setAttribute("crossorigin", "anonymous");
      await new Promise<void>((resolve) => {
        if ((img as HTMLImageElement).complete) {
          resolve();
          return;
        }
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
    }),
  );

  return clone;
};
