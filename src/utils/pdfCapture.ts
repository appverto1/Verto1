const imageDataUrlCache = new Map<string, string>();
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const MAX_PDF_IMAGE_BYTES = 10 * 1024 * 1024;

const resolveImageUrl = (src: string) => {
  const normalized = String(src || "").trim();
  if (!normalized || normalized.startsWith("data:") || normalized.startsWith("blob:")) return normalized;
  try {
    return new URL(normalized, window.location.href).toString();
  } catch {
    return "";
  }
};

const shouldInlineImage = (src: string) => {
  const resolved = resolveImageUrl(src);
  return /^https?:\/\//i.test(resolved);
};

export const convertImageUrlToDataUrl = async (src: string): Promise<string | null> => {
  const normalized = String(src || "").trim();
  if (!normalized) return null;
  if (!shouldInlineImage(normalized)) return normalized;

  const resolved = resolveImageUrl(normalized);
  if (!resolved) return null;
  if (imageDataUrlCache.has(resolved)) {
    return imageDataUrlCache.get(resolved) || null;
  }

  try {
    const url = new URL(resolved);
    const sameOrigin = url.origin === window.location.origin;
    const response = await fetch(resolved, {
      method: "GET",
      mode: sameOrigin ? "same-origin" : "cors",
      credentials: sameOrigin ? "include" : "omit",
      cache: "force-cache",
    });
    if (!response.ok) {
      throw new Error(`Falha ao carregar imagem (${response.status})`);
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      throw new Error("O recurso retornado não é uma imagem válida.");
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_PDF_IMAGE_BYTES) {
      throw new Error("Imagem excede o limite seguro para inclusão no PDF.");
    }

    const blob = await response.blob();
    if (!String(blob.type || contentType).toLowerCase().startsWith("image/")) {
      throw new Error("O conteúdo carregado não possui MIME de imagem.");
    }
    if (blob.size > MAX_PDF_IMAGE_BYTES) {
      throw new Error("Imagem excede o limite seguro para inclusão no PDF.");
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha ao converter imagem para base64."));
      reader.readAsDataURL(blob);
    });

    imageDataUrlCache.set(resolved, dataUrl);
    return dataUrl;
  } catch (error) {
    console.warn("Não foi possível converter imagem para base64 antes do PDF:", error);
    return null;
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
      img.setAttribute("src", nextSrc || TRANSPARENT_PIXEL);
      if (String(nextSrc || '').startsWith('http')) img.setAttribute("crossorigin", "anonymous");
      else img.removeAttribute("crossorigin");
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
