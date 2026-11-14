// 记账小组件安装代码：在 Scriptable 里新建脚本，命名为“记账”，粘贴这一段。
// 每次运行都会下载最新的小组件代码，所以以后不用再改这里。
const url = "https://zkmfung.github.io/ledger-dashboard/ledger-widget.js";
const fm = FileManager.local();
const saved = fm.joinPath(fm.documentsDirectory(), "ledger-widget-code.js");
let code = null;
try {
  const req = new Request(url);
  const body = await req.loadString();
  if (req.response.statusCode === 200 && body.includes("ledger-widget")) { code = body; fm.writeString(saved, body); }
} catch (e) {}
if (!code && fm.fileExists(saved)) code = fm.readString(saved);
if (!code) throw new Error("下载小组件代码失败，检查网络后再试");
await eval(`(async () => {\n${code}\n})()`);
