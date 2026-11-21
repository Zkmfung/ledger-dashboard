// 记账小组件（Scriptable）：iPhone 桌面 / 锁屏显示当月支出、指定日期的支出、分类和最近几笔，点一下打开完整看板。
//
// 由 tools/ios/install-widget.js 这段安装代码下载并运行，所以这里改了以后手机上会自动用上新版本。
// 数据来自加密的看板网页：在一个隐藏的 WebView 里打开它，调用网页自己的 decrypt()，
// 密码存在 Scriptable 的钥匙串里（第一次在 App 里运行时输入）。解密成功后把汇总存一份，
// 下次刷新失败时先显示上次的数据和原日期；iOS 延迟刷新时也不会把旧金额标成“今天”。

const BASE = "https://zkmfung.github.io/ledger-dashboard/";
const KEYCHAIN = "ledger-dashboard";
const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), "ledger-widget-summary.json");

const ICON = { 餐饮: "🍜", 交通: "🚇", 购物: "🛍️", 居住: "🏠", 娱乐: "🎮", 医疗: "💊", 教育: "📚", 人情: "🎁", 金融: "💳", 其他: "📦" };

// ---------- data ----------
async function password(interactive) {
  if (Keychain.contains(KEYCHAIN)) return Keychain.get(KEYCHAIN);
  if (!interactive) return null;
  const a = new Alert();
  a.title = "记账看板密码";
  a.message = "和网页看板的密码一样，只存在这台手机的钥匙串里。";
  a.addSecureTextField("密码");
  a.addAction("保存");
  a.addCancelAction("取消");
  if ((await a.presentAlert()) === -1) return null;
  const pw = a.textFieldValue(0);
  Keychain.set(KEYCHAIN, pw);
  return pw;
}

async function fetchData(pw) {
  const wv = new WebView();
  await wv.loadURL(BASE + "?widget=" + Date.now());
  const js = `(function () {
    if (typeof PAYLOAD === "undefined" || !PAYLOAD) return completion("ERR:page");
    if (PAYLOAD.data) return completion(JSON.stringify(PAYLOAD.data));
    decrypt(PAYLOAD.encrypted, ${JSON.stringify(pw)})
      .then(d => completion(JSON.stringify(d)), () => completion("ERR:password"));
  })()`;
  const out = await wv.evaluateJavaScript(js, true);
  if (typeof out !== "string" || out.startsWith("ERR:")) throw new Error(String(out));
  return JSON.parse(out);
}

const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function prevMonth(ym) {
  let [y, m] = ym.split("-").map(Number);
  m -= 1; if (m < 1) { m = 12; y -= 1; }
  return `${y}-${pad(m)}`;
}

// Pure: ledger rows -> what the widget shows. Kept free of Scriptable APIs so it can be tested.
function summarize(data, today) {
  const rows = data.rows.map(r => Object.fromEntries(data.columns.map((k, i) => [k, r[i]])));
  const month = today.slice(0, 7), day = +today.slice(8);
  const exp = rows.filter(t => t.type === "expense" && t.date.startsWith(month));
  const sum = a => a.reduce((s, t) => s + t.amount, 0);
  const total = sum(exp);
  const prevSame = sum(rows.filter(t => t.type === "expense" && t.date.startsWith(prevMonth(month)) && +t.date.slice(8) <= day));
  const byCat = {};
  exp.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  return {
    as_of: today,
    month: +month.slice(5),
    total,
    today: sum(exp.filter(t => t.date === today)),
    todayCount: exp.filter(t => t.date === today).length,
    income: sum(rows.filter(t => t.type === "income" && t.date.startsWith(month))),
    delta: prevSame > 0 ? (total - prevSame) / prevSame * 100 : null,
    count: exp.length,
    cats: Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ c, v })),
    // last seven calendar days ending today, for the small bar chart
    week: Array.from({ length: 7 }, (_, i) => {
      const d = new Date(+today.slice(0, 4), +today.slice(5, 7) - 1, day - 6 + i);
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return { d: key, v: sum(rows.filter(t => t.type === "expense" && t.date === key)) };
    }),
    recent: exp.slice(-6).reverse().map(t => ({ date: t.date, what: t.description || t.counterparty || "", amount: t.amount })),
    generated: data.generated_at,
    checked: new Date().toISOString(),
  };
}

function periodLabels(s) {
  const date = typeof s.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.as_of) ? s.as_of : null;
  return {
    month: date ? date.slice(0, 7).replace("-", "/") : `${s.month}月`,
    day: date ? `${+date.slice(5, 7)}/${+date.slice(8)}` : "上次记录",
    asOf: date || "日期未知",
  };
}

// ---------- widget ----------
// Plain white (dark: near-black) card with the same palette as the dashboard; colors follow light/dark mode.
const dyn = (light, dark, a = 1) => Color.dynamic(new Color(light, a), new Color(dark, a));
const BG = dyn("#ffffff", "#1c1c1e");
const INK = dyn("#111114", "#f2f2f5");
const SOFT = dyn("#8a8a93", "#8d8d95");
const ACCENT = dyn("#2a78d6", "#3987e5");
const ACCENT_FAINT = dyn("#2a78d6", "#3987e5", 0.28);
const TRACK = dyn("#ececf1", "#2c2c2e");
const MORE = dyn("#d93a3a", "#ff6b6b"), LESS = dyn("#12924a", "#4cd07d");
const CAT_HEX = { 餐饮: ["#2a78d6", "#3987e5"], 交通: ["#eb6834", "#d95926"], 购物: ["#1baf7a", "#199e70"], 居住: ["#eda100", "#c98500"],
  娱乐: ["#e87ba4", "#d55181"], 医疗: ["#008300", "#008300"], 教育: ["#6250d6", "#9085e9"], 人情: ["#e34948", "#e66767"] };
const catColor = c => dyn(...(CAT_HEX[c] || ["#9a9aa2", "#6e6e76"]));
const WEEK = "日一二三四五六";
const money = v => "¥" + v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyInt = v => "¥" + Math.round(v).toLocaleString("zh-CN");

function text(stack, s, size, opts = {}) {
  const t = stack.addText(s);
  t.font = opts.weight === "bold" ? Font.boldRoundedSystemFont(size) : opts.weight === "semibold" ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = opts.color || INK;
  t.lineLimit = 1;
  if (opts.scale) t.minimumScaleFactor = opts.scale;
  return t;
}

function deltaRow(stack, s) {
  if (s.delta === null || s.delta === undefined) return;
  const row = stack.addStack();
  row.centerAlignContent();
  text(row, `${s.delta > 0 ? "↑" : "↓"}${Math.abs(s.delta).toFixed(0)}%`, 11, { weight: "semibold", color: s.delta > 0 ? MORE : LESS });
  row.addSpacer(3);
  text(row, "比上月同期", 11, { color: SOFT });
}

// Today's spending is the headline; the month total sits underneath in small text.
function headline(stack, s, big) {
  const labels = periodLabels(s);
  const n = Number.isFinite(s.todayCount) && s.todayCount > 0 ? ` · ${s.todayCount} 笔` : "";
  // Always use a calendar date: iOS may keep this rendered widget past midnight.
  text(stack, `${labels.day} 支出${n}`, 12, { color: SOFT });
  stack.addSpacer(1);
  text(stack, money(s.today), big, { weight: "semibold", scale: 0.5 });
  stack.addSpacer(4);
  text(stack, `${labels.month} 累计 ${moneyInt(s.total)}`, 11, { color: SOFT });
  stack.addSpacer(1);
  deltaRow(stack, s);
}

// Seven thin bars, the last one (the summary's own date) in full color.
function weekBars(stack, s, barW, maxH, labels) {
  const week = Array.isArray(s.week) ? s.week : [];
  if (!week.length) return;
  const max = Math.max(...week.map(d => d.v), 1);
  const row = stack.addStack();
  row.bottomAlignContent();
  week.forEach((d, i) => {
    if (i) row.addSpacer(barW / 2);
    const col = row.addStack();
    col.layoutVertically();
    const bar = col.addStack();
    bar.size = new Size(barW, Math.max(3, maxH * d.v / max));
    bar.backgroundColor = i === week.length - 1 ? ACCENT : ACCENT_FAINT;
    bar.cornerRadius = Math.min(3, barW / 2);
    if (labels) {
      col.addSpacer(2);
      const day = new Date(d.d + "T00:00:00");
      const lab = col.addStack();
      lab.size = new Size(barW, 10);
      text(lab, WEEK[day.getDay()], 8, { color: i === week.length - 1 ? INK : SOFT });
    }
  });
}

function catRows(stack, s, n, width) {
  const top = s.cats.slice(0, n);
  if (!top.length) { text(stack, "暂无支出", 12, { color: SOFT }); return; }
  const total = s.cats.reduce((a, g) => a + g.v, 0) || 1;
  top.forEach((g, i) => {
    if (i) stack.addSpacer(7);
    const row = stack.addStack();
    row.size = new Size(width, 0);
    row.centerAlignContent();
    const dot = row.addStack();
    dot.size = new Size(6, 6);
    dot.cornerRadius = 3;
    dot.backgroundColor = catColor(g.c);
    row.addSpacer(5);
    text(row, g.c, 12);
    row.addSpacer();
    text(row, moneyInt(g.v), 12, { weight: "semibold" });
    stack.addSpacer(3);
    const track = stack.addStack();
    track.size = new Size(width, 3);
    track.backgroundColor = TRACK;
    track.cornerRadius = 1.5;
    const bar = track.addStack();
    bar.size = new Size(Math.max(3, width * g.v / total), 3);
    bar.backgroundColor = catColor(g.c);
    bar.cornerRadius = 1.5;
    track.addSpacer();
  });
}

// Two small figures under the categories: daily average and number of payments.
function stats(stack, s, width) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(s.as_of || "") ? +s.as_of.slice(8) : null;
  const row = stack.addStack();
  row.size = new Size(width, 0);
  [[day ? "日均" : "收入", day ? moneyInt(s.total / day) : moneyInt(s.income || 0)], ["笔数", `${s.count} 笔`]].forEach(([k, v], i) => {
    if (i) row.addSpacer();
    const col = row.addStack();
    col.layoutVertically();
    text(col, k, 10, { color: SOFT });
    text(col, v, 14, { weight: "semibold" });
  });
}

function footer(stack, s, stale) {
  const t = (s.generated || "").replace("T", " ").slice(5, 16);
  text(stack, stale ? `⚠︎ 缓存 · ${periodLabels(s).asOf}` : `更新于 ${t}`, 9, { color: SOFT, scale: 0.7 });
  if (stale && t) text(stack, `账本更新于 ${t}`, 9, { color: SOFT });
}

function build(s, family, stale) {
  const w = new ListWidget();
  w.url = BASE;
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);

  if (family === "accessoryRectangular" || family === "accessoryInline" || family === "accessoryCircular") {
    const labels = periodLabels(s);
    if (family === "accessoryInline") { w.addText(`${stale ? "缓存 · " : ""}${labels.day} ${moneyInt(s.today)} · ${labels.month} ${moneyInt(s.total)}`); return w; }
    if (family === "accessoryCircular") {
      const a = w.addText(labels.day); a.font = Font.systemFont(9); a.centerAlignText();
      const t = w.addText(moneyInt(s.today)); t.font = Font.boldRoundedSystemFont(14); t.minimumScaleFactor = 0.5; t.centerAlignText();
      if (stale) { const c = w.addText("缓存"); c.font = Font.systemFont(9); c.centerAlignText(); }
      return w;
    }
    const a = w.addText(`${stale ? "缓存 · " : ""}${labels.day} 支出`); a.font = Font.systemFont(11);
    const b = w.addText(money(s.today)); b.font = Font.boldRoundedSystemFont(20); b.minimumScaleFactor = 0.6;
    const c = w.addText(`${labels.month} 累计 ${moneyInt(s.total)}`); c.font = Font.systemFont(11);
    return w;
  }

  w.backgroundColor = BG;
  w.setPadding(14, 15, 12, 15);

  if (family === "small") {
    headline(w, s, 28);
    w.addSpacer();
    weekBars(w, s, 10, 22, false);
    w.addSpacer(6);
    footer(w, s, stale);
    return w;
  }

  const top = w.addStack();
  top.topAlignContent();
  const left = top.addStack();
  left.layoutVertically();
  headline(left, s, family === "large" ? 34 : 30);
  left.addSpacer();
  weekBars(left, s, 10, family === "large" ? 30 : 22, true);
  top.addSpacer();
  const right = top.addStack();
  right.layoutVertically();
  catRows(right, s, family === "large" ? 4 : 3, 136);
  right.addSpacer(12);
  stats(right, s, 136);

  if (family === "large") {
    w.addSpacer(14);
    text(w, "最近", 11, { color: SOFT });
    w.addSpacer(6);
    s.recent.slice(0, 6).forEach(t => {
      const row = w.addStack();
      row.centerAlignContent();
      const d = row.addStack();
      d.size = new Size(38, 0);
      text(d, `${+t.date.slice(5, 7)}/${+t.date.slice(8)}`, 12, { color: SOFT });
      text(row, t.what.replace(/^推测[:：]\s*/, ""), 13);
      row.addSpacer();
      text(row, money(t.amount), 13, { weight: "semibold" });
      w.addSpacer(7);
    });
  }
  w.addSpacer();
  footer(w, s, stale);
  return w;
}

function message(lines) {
  const w = new ListWidget();
  w.url = BASE;
  w.backgroundColor = BG;
  lines.forEach(l => { const t = w.addText(l); t.textColor = INK; t.font = Font.systemFont(12); });
  return w;
}

// ---------- main ----------
async function main() {
  const family = config.widgetFamily || "medium";
  const pw = await password(!config.runsInWidget);
  let summary = null, stale = false;
  if (pw) {
    try {
      summary = summarize(await fetchData(pw), iso(new Date()));
      fm.writeString(CACHE, JSON.stringify(summary));
    } catch (e) {
      if (String(e).includes("password")) {
        Keychain.remove(KEYCHAIN);
        if (!config.runsInWidget) { await password(true); return main(); }
      }
      console.log("刷新失败：" + e);
    }
  }
  if (!summary && fm.fileExists(CACHE)) {
    try { summary = JSON.parse(fm.readString(CACHE)); stale = true; }
    catch (e) { console.log("读取缓存失败：" + e); }
  }

  const widget = summary ? build(summary, family, stale)
    : message(pw ? ["记账看板打不开", "检查网络后点一下重试"] : ["还没设置密码", "在 Scriptable 里运行一次“记账”"]);
  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else if (summary) {
    await widget.presentMedium();
  }
  Script.complete();
}

if (typeof module !== "undefined" && module.exports && typeof Script === "undefined") {
  module.exports = { summarize };  // node tests
} else {
  await main();
}
