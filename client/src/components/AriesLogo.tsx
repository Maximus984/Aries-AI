import { useMemo, useState } from "react";

type AriesLogoProps = {
  className?: string;
  alt?: string;
};

export const AriesLogo = ({ className, alt = "Aries logo" }: AriesLogoProps) => {
  const sources = useMemo(() => ["/media/aries-logo.svg", "/media/aries-logo.png", "/media/aries-logo.webp"], []);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className={`aries-logo-fallback ${className ?? ""}`.trim()} aria-label={alt}>
        A
      </span>
    );
  }

  return (
    <img
      className={`aries-logo ${className ?? ""}`.trim()}
      src={sources[sourceIndex]}
      alt={alt}
      loading="eager"
      decoding="async"
      onError={() => {
        if (sourceIndex < sources.length - 1) {
          setSourceIndex((previous) => previous + 1);
          return;
        }
        setFailed(true);
      }}
    />
  );
};
