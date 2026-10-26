import http from "node:http";
let version = "A";
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:8765");
  if (url.pathname === "/set") {
    version = url.searchParams.get("v") || "A";
    res.end("ok");
    return;
  }
  if (url.pathname === "/redirect") {
    res.writeHead(302, { Location: "http://localhost:8765/" });
    res.end();
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const mode = url.searchParams.get("mode");
  res.end(
    `<!doctype html><html lang="zh-Hant"><title>DiffWatch 測試 ${version}</title><style>body{font:18px system-ui;padding:30px}#products{padding:20px;border:2px solid teal}.hidden{display:none}</style><h1>可控制測試網站</h1><p>用 /set?v=B 改變版本；重新載入才套用。?mode=delay|unstable|login|large|empty|ambiguous</p><main id="products">${mode === "login" ? '<div id="login">請登入</div>' : mode === "empty" ? "" : mode === "benchmark" ? "<p>商品 100 元</p>".repeat(2499) + "尾" : mode === "large" ? Array.from({ length: 21000 }, (_, i) => "<span>" + i + "</span>").join("") : `<h2>商品 ${version}</h2><p>價格 ${version === "A" ? "100" : "120"}</p><a href="/item?v=${version}">商品連結</a><img src="/image-${version}.png" alt="商品 ${version}"><span class="countdown">倒數 10</span><p class="hidden">隱藏文字</p>`}</main>${mode === "ambiguous" ? '<main id="products">重複根元素</main>' : ""}<script>let n=0;setInterval(()=>{const e=document.querySelector('.countdown');if(e)e.textContent='倒數 '+n++},1000);${mode === "delay" ? `setTimeout(()=>document.querySelector('#products').append('延遲內容'),5000);` : ""}${mode === "unstable" ? `setInterval(()=>document.querySelector('h2').textContent=String(Date.now()),700);` : ""}</script></html>`,
  );
});
server.listen(8765, "127.0.0.1", () =>
  console.log(
    "Fixture: http://127.0.0.1:8765 · /set?v=B · ?mode=delay|unstable|login|large|empty|ambiguous",
  ),
);
