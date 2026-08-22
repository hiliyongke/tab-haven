import { useEffect, useState } from 'react';

/** 原生标签组：直接用 Chrome 组色 CSS 变量（与组圆点同源）。 */
export function groupAccentVar(color?: string): string {
  return `var(--group-${color || 'grey'})`;
}

/**
 * 域名 → 稳定强调色（HSL）。同一域名永远得到同一颜色，且饱和度/亮度收敛在
 * 不刺眼的区间，保证「不同组不同色」又不破坏侧边栏的低干扰基调。
 */
function domainAccent(domain: string): string {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = (hash * 31 + domain.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  const sat = 58 + (Math.abs(hash >> 3) % 14); // 58–71%
  const light = 54 + (Math.abs(hash >> 7) % 8); // 54–61%
  return `hsl(${hue} ${sat}% ${light}%)`;
}

/** 从 data: URL favicon 提取主色（canvas 可读，无 CORS 污染）。失败返回 null。 */
function extractFaviconColor(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!dataUrl.startsWith('data:')) return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        const n = 16;
        const canvas = document.createElement('canvas');
        canvas.width = n;
        canvas.height = n;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, n, n);
        const { data } = ctx.getImageData(0, 0, n, n);
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha === undefined || alpha < 24) continue; // 跳过透明像素
          const r0 = data[i];
          const g0 = data[i + 1];
          const b0 = data[i + 2];
          if (r0 === undefined || g0 === undefined || b0 === undefined) continue;
          r += r0;
          g += g0;
          b += b0;
          count++;
        }
        if (!count) return resolve(null);
        resolve(`rgb(${Math.round(r / count)} ${Math.round(g / count)} ${Math.round(b / count)})`);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * 站点组强调色：优先用 favicon 主色（仅 data: URL 可安全读取像素，远程
 * favicon 受 CORS 污染 canvas 无法取色），否则回退到域名哈希色。
 */
export function useDomainAccent(favIconUrl?: string, domain?: string): string | undefined {
  const fallback = domain ? domainAccent(domain) : undefined;
  const [color, setColor] = useState<string | undefined>(fallback);
  useEffect(() => {
    const fb = domain ? domainAccent(domain) : undefined;
    setColor(fb);
    let cancelled = false;
    if (favIconUrl && favIconUrl.startsWith('data:')) {
      extractFaviconColor(favIconUrl).then((c) => {
        if (!cancelled) setColor(c ?? fb);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [favIconUrl, domain]);
  return color;
}
