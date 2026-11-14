#!/usr/bin/env python3
# <xbar.title>记账看板</xbar.title>
# <xbar.desc>在 Mac 菜单栏显示本月支出、分类和最近几笔，数据来自加密的记账看板网页。</xbar.desc>
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
"""SwiftBar plugin for the ledger dashboard.

Downloads the encrypted dashboard page, decrypts it with the password kept in the
macOS Keychain (service "ledger-dashboard"), and prints a SwiftBar menu. The file
name's ".30m." makes SwiftBar refresh it every 30 minutes.

Standalone on purpose: it runs on the Mac without this repo, using only the
standard library of the python3 that ships with macOS (3.9), so no newer syntax.
Decryption mirrors finance/dashboard.py.
"""

import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
from collections import defaultdict
from datetime import date

URL = os.environ.get("LEDGER_DASHBOARD_URL", "https://zkmfung.github.io/ledger-dashboard/")
KEYCHAIN_SERVICE = "ledger-dashboard"
RECENT = 8


def fetch(url):
    # curl uses the system certificates; urllib in some Mac Pythons does not.
    return subprocess.run(["curl", "-fsSL", "--max-time", "20", url], check=True,
                          capture_output=True).stdout.decode("utf-8")


def password():
    pw = os.environ.get("LEDGER_DASHBOARD_PASSWORD")
    if pw:
        return pw
    out = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
                         capture_output=True, text=True)
    return out.stdout.strip() if out.returncode == 0 else ""


def payload(html):
    marker = "const PAYLOAD = "
    return json.JSONDecoder().raw_decode(html[html.index(marker) + len(marker):])[0]


def _keystream(key, nonce, length):
    blocks = (length + 31) // 32
    return b"".join(hmac.new(key, nonce + i.to_bytes(4, "big"), "sha256").digest() for i in range(blocks))[:length]


def decrypt(box, pw):
    d = lambda k: base64.b64decode(box[k])
    key = hashlib.pbkdf2_hmac("sha256", pw.encode(), d("salt"), box["iter"], dklen=64)
    enc_key, mac_key = key[:32], key[32:]
    nonce, ct = d("nonce"), d("ct")
    if not hmac.compare_digest(hmac.new(mac_key, nonce + ct, "sha256").digest(), d("tag")):
        raise ValueError("bad password")
    return bytes(a ^ b for a, b in zip(ct, _keystream(enc_key, nonce, len(ct))))


def money(v):
    return ("-¥" if v < 0 else "¥") + "{:,.2f}".format(abs(v))


def short(text, n=18):
    return text if len(text) <= n else text[:n - 1] + "…"


def prev_month(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return "{:04d}-{:02d}".format(y - 1, 12) if m == 1 else "{:04d}-{:02d}".format(y, m - 1)


def menu(data, url, today=None):
    """SwiftBar output lines for the current month."""
    cols = data["columns"]
    rows = [dict(zip(cols, r)) for r in data["rows"]]
    month = (today or date.today().isoformat())[:7]
    cur = [t for t in rows if t["date"].startswith(month)]
    exp = [t for t in cur if t["type"] == "expense"]
    total = sum(t["amount"] for t in exp)
    income = sum(t["amount"] for t in cur if t["type"] == "income")
    prev = sum(t["amount"] for t in rows if t["date"].startswith(prev_month(month)) and t["type"] == "expense")
    today_exp = sum(t["amount"] for t in exp if t["date"] == (today or date.today().isoformat()))

    lines = ["¥{:,.0f} | sfimage=yensign.circle".format(total), "---"]
    head = "{}月支出 {}".format(int(month[5:]), money(total))
    if prev > 0:
        d = (total - prev) / prev * 100
        head += "（比上月 {} {:.0f}%）".format("↑" if d > 0 else "↓", abs(d))
    lines += [head, "今天 {} · 收入 {} · 结余 {}".format(money(today_exp), money(income), money(income - total)), "---"]

    by_cat = defaultdict(float)
    for t in exp:
        by_cat[t["category"]] += t["amount"]
    if by_cat:
        lines.append("分类")
        for c, v in sorted(by_cat.items(), key=lambda x: -x[1]):
            lines.append("{}  {}  {:.0f}%".format(c, money(v), v / total * 100))
        lines.append("---")
    if exp:
        lines.append("最近几笔")
        for t in list(reversed(exp))[:RECENT]:  # rows arrive sorted by date and time
            mark = " (推断)" if t["status"] == "guessed" else ""
            what = short((t["description"] or t["counterparty"] or "").replace("|", "/"))
            lines.append("{}/{} {}  {}{}".format(int(t["date"][5:7]), int(t["date"][8:]), what, money(t["amount"]), mark))
        lines.append("---")
    sep = "&" if "?" in url else "?"
    lines += [
        "打开看板小窗口 | href={}{}mini webview=true webvieww=380 webviewh=720".format(url, sep),
        "在浏览器打开 | href={}".format(url),
        "更新于 {} | size=11".format(data.get("generated_at", "").replace("T", " ")),
        "刷新 | refresh=true",
    ]
    return lines


def main():
    try:
        html = fetch(URL)
    except Exception:
        print("记账 ⚠️\n---\n看板网页打不开，检查网络\n刷新 | refresh=true")
        return 0
    p = payload(html)
    if "data" in p:
        data = p["data"]
    else:
        pw = password()
        if not pw:
            print("记账 🔒\n---\n还没把看板密码存进钥匙串，见 docs/dashboard-setup.md\n刷新 | refresh=true")
            return 0
        try:
            data = json.loads(decrypt(p["encrypted"], pw))
        except ValueError:
            print("记账 🔒\n---\n钥匙串里的看板密码不对，重新保存一次\n刷新 | refresh=true")
            return 0
    print("\n".join(menu(data, URL)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
