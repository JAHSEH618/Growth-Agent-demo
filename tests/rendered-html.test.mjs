import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const demoSource = new URL("../src/demo/index.html", import.meta.url);
const demoShell = new URL("../src/demo/shell.html", import.meta.url);
const demoBuilt = new URL("../public/demo.html", import.meta.url);

// build-demo.mjs 的转义,反过来跑一遍。&amp; 必须最后还原,否则会把 &amp;lt; 二次解成 <
function unescapeAttribute(value) {
  return value
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

function section(html, screen) {
  // 第 0 屏带着 .on,其余不带
  const start = html.search(
    new RegExp(`<section class="rg-page(?: on)?" data-screen="${screen}"`),
  );
  assert.ok(start > 0, `找不到第 ${screen} 屏`);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end);
}

// "¥180万" / "−¥75万" → 180 / -75
function wan(text) {
  const value = Number.parseFloat(text.replace("−", "-").replace(/[^0-9.-]/g, ""));
  assert.ok(Number.isFinite(value), `读不出金额：${text}`);
  return value;
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("public/demo.html 是 src/demo 的当前构建产物", async () => {
  const [source, shell, built] = await Promise.all([
    readFile(demoSource, "utf8"),
    readFile(demoShell, "utf8"),
    readFile(demoBuilt, "utf8"),
  ]);

  assert.doesNotMatch(built, /%%SRCDOC%%/, "占位符没被替换,构建没跑");

  const srcdoc = built.match(/ srcdoc="([\s\S]*)"><\/iframe>/);
  assert.ok(srcdoc, "外壳里找不到 srcdoc");
  assert.equal(
    unescapeAttribute(srcdoc[1]),
    source,
    "public/demo.html 与 src/demo/index.html 不同步,跑 npm run build:demo",
  );

  // 外壳只提供隔离,不提供能力:allow-same-origin 一旦加进来,sandbox 就白做了
  assert.match(built, /sandbox="allow-scripts"/);
  assert.doesNotMatch(built, /allow-same-origin/);
  assert.match(built, /http-equiv="Content-Security-Policy"/);
  assert.match(built, /referrerpolicy="no-referrer"/);
  assert.ok(shell.includes("%%SRCDOC%%"), "模板丢了占位符");
});

test("六屏与创建向导都在", async () => {
  const source = await readFile(demoSource, "utf8");
  for (let screen = 0; screen <= 5; screen += 1) {
    assert.match(source, new RegExp(`data-screen="${screen}"`), `缺第 ${screen} 屏`);
  }
  assert.equal((source.match(/class="rg-wizard-pane/g) ?? []).length, 4);
});

// 第 2/3/4/5 屏现在都由 plans 模型渲染,所以断言直接吃模型 —— 一次盖住三个计划
async function planModel() {
  const source = await readFile(demoSource, "utf8");
  const open = source.indexOf("{", source.indexOf("const plans="));
  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    if (source[end] === "{") depth += 1;
    else if (source[end] === "}" && (depth -= 1) === 0) break;
  }
  assert.ok(depth === 0, "plans 模型的花括号没闭合");
  return new Function(`return ${source.slice(open, end + 1)}`)();
}

test("每个计划的效果验证推导条自己算得平", async () => {
  const plans = await planModel();
  for (const [key, plan] of Object.entries(plans)) {
    if (!plan.exp) continue;
    const cells = new Map(plan.exp.formula);
    // 还在实验窗口内的计划标的是「观测收入」且一律为「—」,由下一条测,这里跳过
    if (cells.get("增量收入") === undefined || cells.get("增量收入") === "—") continue;

    const [income, goods, spend, profit] = ["增量收入", "商品成本", "实验期投资成本", "增量利润"].map(
      (label) => wan(cells.get(label)),
    );
    assert.equal(income + goods + spend, profit, `${key}：增量收入 − 商品成本 − 投资成本 ≠ 增量利润`);

    const orders = Number.parseInt(cells.get("增量订单").replace(/[^0-9]/g, ""), 10);
    const ticket = (income * 10000) / orders;
    assert.ok(ticket > 60 && ticket < 200, `${key}：客单 ¥${ticket.toFixed(0)} 不像连锁餐饮`);
    const margin = (income + goods) / income;
    assert.ok(margin >= 0.55, `${key}：毛利率 ${(margin * 100).toFixed(1)}% 低于向导里承诺的 55%`);
  }
});

test("没有可归因的数时,不许出现编造的数字", async () => {
  const plans = await planModel();
  const learning = plans.vip;
  assert.equal(learning.verified, null, "还在实验窗口内的计划不该有已验证增量利润");
  assert.equal(learning.opt, null, "归因未完成的计划不该给出调仓建议");
  assert.equal(learning.report, false, "未结算的计划不该有投资报告");
  for (const [label, value] of learning.exp.formula) {
    if (label === "实验期投资成本") continue; // 已投入是已知的
    assert.equal(value, "—", `${label} 在归因完成前必须是「—」`);
  }
  for (const [, value] of learning.exp.kpis) {
    assert.equal(value, "—", "学习中的计划,四张 KPI 都必须是「—」");
  }
});

test("每个计划的调仓都等于它自己的剩余预算,且不跨计划", async () => {
  const plans = await planModel();
  const others = Object.values(plans).flatMap((p) => [p.name, p.label]);

  for (const [key, plan] of Object.entries(plans)) {
    if (!plan.opt) continue;
    const remaining = plan.budget - plan.spend;
    const sum = (field) => plan.opt.rows.reduce((total, row) => total + row[field], 0);
    assert.equal(sum("from"), remaining, `${key}：调整前合计 ≠ 剩余预算`);
    assert.equal(sum("to"), remaining, `${key}：调整后合计 ≠ 剩余预算`);

    // 计划内调仓只能动自己的方案,不能动别的计划
    for (const row of plan.opt.rows) {
      const foreign = others.filter((n) => n !== plan.name && n !== plan.label && row.name.includes(n));
      assert.deepEqual(foreign, [], `${key}：调仓表里混进了别的计划「${foreign[0]}」`);
    }
    // 调仓必须真的换来钱,否则这一屏没有存在的理由
    const produce = (field) =>
      plan.opt.rows.reduce((total, row) => total + (row.roi ? row[field] * row.roi : 0), 0);
    assert.ok(produce("to") > produce("from"), `${key}：调整后的预期产出没有变高`);
  }
});

test("工具竞争表的窗口投入不超过计划累计已投入", async () => {
  const plans = await planModel();
  for (const [key, plan] of Object.entries(plans)) {
    const windowed = plan.matrix.rows.reduce((total, row) => total + row.spend, 0);
    assert.ok(windowed <= plan.spend, `${key}：归因窗口内 ¥${windowed}万 超过了累计已投入 ¥${plan.spend}万`);
  }
});

test("方案预算合计等于计划预算", async () => {
  const plans = await planModel();
  for (const [key, plan] of Object.entries(plans)) {
    const total = plan.schemes.reduce((sum, scheme) => sum + scheme.budget, 0);
    assert.equal(total, plan.budget, `${key}：方案预算合计 ≠ 计划预算`);
  }
});

test("页面不加载任何第三方脚本", async () => {
  const source = await readFile(demoSource, "utf8");
  assert.doesNotMatch(source, /<script[^>]+\ssrc=/i, "demo 又挂上了外链脚本");
  assert.match(source, /script-src 'unsafe-inline';/, "script-src 被放宽了");
});

test("外壳带着分享卡元数据,og:image 有绝对域名的位置", async () => {
  const shell = await readFile(demoShell, "utf8");
  for (const tag of ["og:title", "og:description", "og:image", "twitter:card", "twitter:image"]) {
    assert.ok(shell.includes(tag), `外壳缺 ${tag}`);
  }
  assert.match(shell, /content="%%ORIGIN%%\/og\.png"/, "og:image 少了构建时注入的域名占位符");
});

test("经营总览:英雄数字等于它旁边印着的两笔", async () => {
  const screen = section(await readFile(demoSource, "utf8"), 0);

  const claim = Number(screen.match(/<b>¥(\d+)<em>万<\/em><\/b>/)[1]);
  const [, first, second] = screen.match(
    /新会员复购 ¥(\d+)万 ＋ 沉睡召回 ¥(\d+)万/,
  );
  assert.equal(claim, Number(first) + Number(second), "已验证增量利润 ≠ 它印出来的两笔之和");

  // 待归因的那笔必须留在这个数之外
  assert.match(screen, /尚未通过归因，不计入本数/);
});

test("vinext 渲染出的是 demo 外壳,不是 starter 骨架", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Growth Agent<\/title>/);
  assert.match(html, /src="\/demo\.html"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /<html lang="zh-CN">/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});
