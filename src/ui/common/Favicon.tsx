/** 站点图标：加载失败时回退为标题首字母。 */
export function Favicon({
  src,
  title,
  size = 16
}: {
  src?: string;
  title: string;
  size?: number;
}) {
  const fallback = (title || '?').trim().charAt(0).toUpperCase();
  if (!src) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded bg-gray-200 text-[10px] font-semibold text-gray-500"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {fallback}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="shrink-0"
      style={{ width: size, height: size }}
      onError={(event) => {
        event.currentTarget.style.display = 'none';
        event.currentTarget.insertAdjacentText('afterend', fallback);
      }}
    />
  );
}
