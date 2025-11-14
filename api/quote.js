// api/quote.js
const { quote } = require("../price/quote-engine");

module.exports = async (req, res) => {
  // ① 新增：企业微信验证 URL 时会发 GET
  if (req.method === "GET") {
    res.status(200).send("ok");   // 只需要返回 200 + 任意内容即可
    return;
  }

  // ② 保留你的原 POST 限制
  if (req.method !== "POST") {
    res.status(405).json({ error: "Only POST is allowed" });
    return;
  }

  // Vercel 默认解析 JSON
  let body = req.body;
  if (!body || typeof body !== "object") {
    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf-8");
      body = JSON.parse(raw);
    } catch (e) {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
  }

  const model = (body.model || body.text || "").trim();
  if (!model) {
    res.status(400).json({ error: "缺少型号字段 model 或 text" });
    return;
  }

  const result = quote(model);

  if (!result.ok) {
    res.status(200).json({
      ok: false,
      message: result.error
    });
    return;
  }

  res.status(200).json({
    ok: true,
    model,
    sheet: result.sheet,
    column: result.column,
    row: result.row,
    base_price_eur: result.base_price_eur,
    adjusted_price_eur: result.adjusted_price_eur,
    rule_applied: result.rule_applied,
    rule_formula: result.rule_formula,
    sales_multiplier: result.sales_multiplier,
    sales_price_cny: result.sales_price_cny,
    text: result.text
  });
};
