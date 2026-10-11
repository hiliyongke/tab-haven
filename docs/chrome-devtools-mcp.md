# Chrome DevTools MCP —— AI 侧扩展调试

让编码智能体直接在真实 Chrome 里安装、重载并 inspect 扩展的各个界面，替代「改完代码手动点刷新、人工看侧边栏」这一步。

官方文档：<https://developer.chrome.com/docs/devtools/agents>

## 1. 配置

CodeBuddy 的 MCP 配置文件是 `~/.codebuddy/mcp.json`。把下面这段合并进已有的 `mcpServers` 节点（若该节点已存在，**只追加键、不要覆盖整个文件**）：

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--categoryExtensions", "--autoConnect"]
    }
  }
}
```

两个参数的含义，缺一不可：

| 参数                   | 作用                                                             | 缺了会怎样                                                         |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `--categoryExtensions` | 启用扩展相关工具集（安装/列出/重载/触发 action/ inspect 各界面） | 只有普通网页调试工具，管不了扩展                                   |
| `--autoConnect`        | 复用你当前的 Chrome 个人资料与已登录状态                         | 调试用的是干净临时 profile，扩展没装、登录态丢失，无法验证真实环境 |

其他智能体的等价写法：

```bash
claude mcp add chrome-devtools --scope project -- npx chrome-devtools-mcp@latest --categoryExtensions --autoConnect
```

配置写入后不会立即生效：需在 MCP 管理页对新服务点「信任」并重启会话。

## 2. 开启远程调试

MCP 通过 Chrome 的远程调试端口连接，必须手动授权一次：

1. 打开 `chrome://inspect/#remote-debugging`
2. 勾选「允许此浏览器实例进行远程调试」
3. 每个新的浏览器会话都要重新允许一次

连接成功后浏览器顶部会出现横幅「Chrome 目前受到自动测试软件的控制」，属正常现象。

## 3. 在本项目能做什么

能力边界（来自官方）：安装与卸载扩展、列出已装扩展并重载、触发扩展 action、检查 popup / 侧边栏 / Service Worker 每个界面。

落到 Tabs 的高频场景：

| 场景                                | 以前                                | 现在                                        |
| ----------------------------------- | ----------------------------------- | ------------------------------------------- |
| 改完代码验证                        | AI 改完交给你手动 reload + 肉眼检查 | AI 自己 reload 并 inspect 侧边栏 DOM/控制台 |
| 侧边栏白屏 / 脚本被 CSP 拦          | 靠你描述现象猜                      | 直接读侧边栏页面的控制台错误                |
| Service Worker 反复休眠导致状态丢失 | 靠推断                              | 直接 inspect SW 上下文                      |
| 权限变更生效验证                    | 手动                                | 重载后确认                                  |

## 4. 与本项目 AI 规则的边界

`.codebuddy/rules/ai-collaboration` 现有约定是「AI 不重启浏览器/扩展进程，用户自行热更新验证」。接入本 MCP 后，AI 技术上已具备该能力，但**仍然只在你说「帮我验证」时才动浏览器**，日常改码后依旧只交付改动 + 静态校验结果，不主动在浏览器里操作。

如需让 AI 默认自动验证，应显式改那条规则（属于规则变更，需你确认）。

## 5. 排障

- **工具列表里没有扩展类工具** —— 缺 `--categoryExtensions`。
- **连上了但看不到 Tabs 扩展** —— 缺 `--autoConnect`，或远程调试未授权。
- **`npx` 拉包慢 / 拉不到** —— 先用 `npx -y chrome-devtools-mcp@latest --help` 单独验证网络与包可用性。
