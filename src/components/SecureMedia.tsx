import React from "react";
import { toTrustedMediaUrl } from "../utils/mediaSecurity";

type SecureImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  fallback?: React.ReactNode;
};

function normalizePatientPhotoSource(rawSrc?: string | null): string | null {
  const value = typeof rawSrc === "string" ? rawSrc.trim() : "";
  if (!value) return null;
  if (value.startsWith("/api/storage/patient-photos/view?")) return value;

  let storagePath = "";
  if (value.startsWith("patient-photos/")) {
    storagePath = value.slice("patient-photos/".length);
  } else {
    const marker = "/storage/v1/object/sign/patient-photos/";
    if (value.includes(marker)) {
      const tail = value.split(marker)[1] || "";
      storagePath = tail.split("?")[0] || "";
    }
  }

  if (!storagePath) return value;
  try {
    storagePath = decodeURIComponent(storagePath);
  } catch {
    // Mantem o path original quando ele ja veio em texto simples.
  }
  return storagePath
    ? `/api/storage/patient-photos/view?path=${encodeURIComponent(storagePath)}`
    : value;
}

export function SecureImage({ src, fallback = null, onError, loading, decoding, ...props }: SecureImageProps) {
  const normalizedSrc = normalizePatientPhotoSource(typeof src === "string" ? src : null);
  const safeSrc = toTrustedMediaUrl(normalizedSrc);
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);

  React.useEffect(() => {
    setFailedSrc(null);
  }, [safeSrc]);

  if (!safeSrc || failedSrc === safeSrc) return <>{fallback}</>;
  return (
    <img
      {...props}
      src={safeSrc}
      loading={loading || "lazy"}
      decoding={decoding || "async"}
      onError={(event) => {
        setFailedSrc(safeSrc);
        onError?.(event);
      }}
    />
  );
}

type SecureIframeProps = React.IframeHTMLAttributes<HTMLIFrameElement> & {
  fallback?: React.ReactNode;
};

export function SecureIframe({ src, fallback = null, ...props }: SecureIframeProps) {
  const safeSrc = toTrustedMediaUrl(typeof src === "string" ? src : null);
  if (!safeSrc) return <>{fallback}</>;
  return <iframe {...props} src={safeSrc} />;
}
