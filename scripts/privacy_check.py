#!/usr/bin/env python3
"""隐私回归检查（FR-D10.5）：权限冻结 + 零网络请求 + 无第三方遥测。

运行：python3 scripts/privacy_check.py
前置：先执行 pnpm build（读取 .output/chrome-mv3/manifest.json）
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
MANIFEST = ROOT / ".output" / "chrome-mv3" / "manifest.json"

# 权限冻结清单（PRD 附录 A）。新增权限须先走 PRD 变更。
ALLOWED_PERMISSIONS = {
    "sidePanel",
    "tabs",
    "tabGroups",
    "storage",
    "commands",
    "alarms",  # 预留：自动保存（V1.2），当前未启用
}

# 禁止出现的网络通道调用
NETWORK_PATTERNS = [
    r"\bfetch\s*\(",
    r"\bXMLHttpRequest\b",
    r"\bWebSocket\b",
    r"\bsendBeacon\b",
    r"<script[^>]+src=[\"']https?://",
]

issues: list[str] = []

if not MANIFEST.exists():
    print("未找到构建产物，请先运行 pnpm build")
    sys.exit(1)

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
permissions = set(manifest.get("permissions", []))
unexpected = permissions - ALLOWED_PERMISSIONS
if unexpected:
    issues.append(f"未授权权限: {sorted(unexpected)}")

for pattern in NETWORK_PATTERNS:
    for path in SRC.rglob("*"):
        if path.suffix not in (".ts", ".tsx", ".html", ".js"):
            continue
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(pattern, line):
                issues.append(f"发现网络调用: {path.relative_to(ROOT)}:{line_no} {line.strip()[:80]}")

if issues:
    print("隐私回归检查失败:")
    for issue in issues:
        print(f"  ✗ {issue}")
    sys.exit(1)

print(
    f"隐私回归检查通过: 权限 {sorted(permissions)}，"
    f"网络通道调用 0，源码文件 {sum(1 for p in SRC.rglob('*') if p.suffix in ('.ts', '.tsx'))} 个"
)
