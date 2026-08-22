import type { ReactNode } from 'react';

/** 区块外壳：统一的标题层级、锚点 id 与容器宽度。 */
export interface SectionProps {
  id: string;
  /** 眉标（小标签）：由调用方传入已翻译的文案 */
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
}

export function Section({ id, eyebrow, title, intro, children }: SectionProps) {
  const titleId = `${id}-title`;
  return (
    <section className="section" id={id} aria-labelledby={titleId}>
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">{eyebrow}</span>
          <h2 id={titleId}>{title}</h2>
          {intro ? <p>{intro}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}
