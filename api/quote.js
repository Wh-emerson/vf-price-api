// api/quote.js

// 1. 报价引擎
const { quote } = require("../price/quote-engine");

// 2. 企业微信加解密库（WXBizMsgCrypt Node 版）
const WXBizMsgCrypt = require("wxcrypt");

/**
 * 这里填你的配置：
 * - token：企业微信“被动回复”配置页里填的那个 Token（你截图里的）
 * - encodingAESKey：同一页里的 EncodingAESKey
 * - corpId：企业ID（CorpID），在“我的企业”里能看到
 */
const TOKEN = "aibJ_SKLyZIzZTlq6lN1sY_lpTKSCZNsGaF";
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj";
const CorpID = "wwaa053cf8eebf4f4a";

// 创建加解密实例
const cryptor = new WXBizMsgCrypt(token, encodingAESKey, corpId);

module.exports = async (req, res) => {
  // -----------------------------
  // ① 企业微信 URL 校验（GET + echostr）
  // -----------------------------
  if (req.method === "GET") {
    const { msg_signature, timestamp, nonce, echostr } = req.query || {};

    // 带 echostr 的 GET，是企业微信在做验证
    if (echostr) {
      try {
        // wxcrypt 内置 verifyURL：会做签名校验 + 解密，直接给出明文
        const echo = cryptor.verifyURL(
          msg_signature,
          timestamp,
          nonce,
          echostr
        );

        // 文档要求：原样返回明文，不加引号、不包 JSON
        res.status(200).type("text/plain").send(echo);
      } catch (e) {
        // 验证失败，企业微信会认为 URL 不可用
        res.status(400).type("text/plain").send("echostr verify failed");
      }
      return;
    }

    // 普通 GET（比如你自己在浏览器点开）就简单回个 ok
    res.status(200).type("text/plain").send("ok");
    return;
  }

  // -----------------------------
  // ② 业务只接受 POST
  // -----------------------------
  if (req.method !== "POST") {
    res.status(405).json({ error: "Only POST is allowed" });
    return;
  }

  // -----------------------------
  // ③ 解析 body（这里先按 JSON 来处理）
  //    智能机器人那条链路一般是 JSON，不是加密 XML。
  // -----------------------------
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

  // 从可能的字段里抽取“型号”文本
  const model = (
    body.model ||                 // 你自己系统直接传 { model: "..." }
    (body.text && body.text.content) || // 部分企业微信 JSON 结构：{ text: { content: "..." } }
    body.text ||                  // 简单 { text: "..." }
    ""
  ).trim();

  if (!model) {
    res.status(400).json({ error: "缺少型号字段 model 或 text" });
    return;
  }

  // -----------------------------
  // ④ 调用本地报价引擎
  // -----------------------------
  const result = quote(model);

  // -----------------------------
  // ⑤ 拼企业微信需要的“富文本（markdown）”格式
  // -----------------------------

  // 报价失败 → 返回 markdown 的错误提示
  if (!result.ok) {
    const markdown = `❌ 报价失败

> 型号：\`${model}\`
> 原因：${result.error}`;

    res.status(200).json({
      msgtype: "markdown",
      markdown: { content: markdown },
      // 附带原始结构，方便你以后调试或其它系统复用
      raw: {
        ok: false,
        model,
        message: result.error
      }
    });
    return;
  }

  // 报价成功 → 返回一段排好版的 markdown
  const markdown = `**${model} 报价结果**

- 工作表：\`${result.sheet}\`
- 单元格：列 \`${result.column}\`，行 \`${result.row}\`
- 欧元基础价：**€${result.base_price_eur}**
- 调整后欧元价：**€${result.adjusted_price_eur}**
- 人民币销售价：**¥${result.sales_price_cny}**

> 规则：${result.rule_applied}
> 公式：\`${result.rule_formula}\``;

  res.status(200).json({
    // 企业微信真正要吃的部分（被动回复消息体）
    msgtype: "markdown",
    markdown: {
      content: markdown
    },
    // 顺带返回结构化数据
    raw: {
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
      sales_price_cny: result.sales_price_cny
    }
  });
};
