export const LOCAL_PREVIEW = 'local-preview';

export function toDownloadHref(downloadPath, version) {
  if (downloadPath === LOCAL_PREVIEW) return null;
  return downloadPath ?? `/download/tabs-${version}.zip`;
}
