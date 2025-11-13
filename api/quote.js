// api/quote.js
const { quote } = require("../price/quote-engine");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Only POST is allowed" });
    return;
  }

  // Vercel 默认会帮你解析 JSON body（如果 Content-Type: application/json）
  let body = req.body;
  if (!body || typeof body !== "object") {
    // 兜底：自己再读一遍原始 body 尝试解析
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
    // 失败时，直接返回错误文本（和你 GPT failure: passthrough 类似）
    res.status(200).json({
      ok: false,
      message: result.error
    });
    return;
  }

  // 成功时返回结构化数据 + 已经排好版的文本
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
