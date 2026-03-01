export const nowIso = () => new Date().toISOString();

export const shortId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const formatLocalTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

export const trimPreview = (value: string, length = 52) => {
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, length - 3)}...`;
};
