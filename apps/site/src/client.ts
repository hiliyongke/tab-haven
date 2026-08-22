/**
 * 客户端行为脚本（产物约 2KB，不含 React）。
 *
 * 只做两件 HTML/CSS 做不到的事：移动端导航开合、演示区 tablist 的键盘操作。
 * 其余交互（FAQ 与文档的展开、锚点跳转）全部交给原生 `<details>` 与 CSS，
 * 因此**没有脚本时页面依然完整可读** —— 这是渐进增强，不是降级。
 */

/**
 * 先给 <html> 打上 js 标记：移动端导航的「收起」样式只在 `.js` 下生效。
 *
 * 没有脚本时菜单就保持展开（作为静态块落在导航下方），导航链接、语言切换与下载
 * 按钮因此始终可达 —— 收起能力是增强，不是前提。
 */
document.documentElement.classList.add('js');

/** 移动端导航：aria-expanded 是真值来源，class 只是样式的投影。 */
function setupNav(): void {
  const toggle = document.querySelector<HTMLButtonElement>('.nav-toggle');
  const menu = document.getElementById('nav-menu');
  if (!toggle || !menu) return;

  const setOpen = (open: boolean): void => {
    menu.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || toggle.getAttribute('aria-expanded') !== 'true') return;
    setOpen(false);
    toggle.focus();
  });

  // 点任意导航链接后收起：锚点跳转本身不会重新渲染导航
  menu.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('a')) setOpen(false);
  });
}

/** 演示区 tablist：←→ / Home / End 键盘操作，首次接管时收起非首帧。 */
function setupTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
  if (tabs.length === 0) return;

  const panels = tabs.map((tab) => {
    const id = tab.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  });

  const select = (index: number): void => {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = panels[i];
      if (panel) panel.hidden = !selected;
    });
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', (event) => {
      const last = tabs.length - 1;
      let next: number;
      if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
      else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = last;
      else return;

      event.preventDefault();
      select(next);
      tabs[next]?.focus();
    });
  });

  select(0);
}

setupNav();
setupTabs();
