import React from "react";
import { toTrustedMediaUrl } from "../utils/mediaSecurity";

type SecureImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  fallback?: React.ReactNode;
};

export function SecureImage({ src, fallback = null, ...props }: SecureImageProps) {
  const safeSrc = toTrustedMediaUrl(typeof src === "string" ? src : null);
  if (!safeSrc) return <>{fallback}</>;
  return <img {...props} src={safeSrc} />;
}

type SecureIframeProps = React.IframeHTMLAttributes<HTMLIFrameElement> & {
  fallback?: React.ReactNode;
};

export function SecureIframe({ src, fallback = null, ...props }: SecureIframeProps) {
  const safeSrc = toTrustedMediaUrl(typeof src === "string" ? src : null);
  if (!safeSrc) return <>{fallback}</>;
  return <iframe {...props} src={safeSrc} />;
}
