/**
 * 客户端入口：产物里**只有**这几个 import —— 一份 CSS 与约 1KB 的行为脚本。
 *
 * 刻意不 import react / react-dom：页面由构建期预渲染产出，客户端不做 hydrate，
 * 引 React 只会把整套运行时打进产物（首屏与体积双双变差）。
 */
import './styles/tokens.css';
import './styles/base.css';
import './styles/art.css';
import './styles/components.css';
import './styles/sections.css';
import './client';
