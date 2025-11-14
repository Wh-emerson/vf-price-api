// api/quote.js

// ① 报价引擎（你原来的逻辑）
const { quote } = require("../price/quote-engine");

// ② 企业微信加解密：wxcrypt（WXBizMsgCrypt 的 NodeJS 实现）
const WXBizMsgCrypt = require("wxcrypt");

/**
 * ========【这里一定要改成你自己的】========
 * 这三个值必须和企业微信后台配置页完全一致：
 * - token：页面上的 Token
 * - encodingAESKey：页面上的 EncodingAESKey（必须 43 位）
 * - corpId：企业 ID（“我的企业 → 企业ID”，一般以 ww 开头）
 */
const token = "zFzTonc1nNK0bA6qWRPX38WP";
const encodingAESKey = "HYq56QNtD9Kvo4bZcMWiyJfq54JCe7EuuhfCpCfCkz1";
const corpId = "wwaa053cf8eebf4f4a"; // 例：ww1234567890abcdef

// 为了避免 AESKey 配错时在模块加载阶段就崩掉，封装一个安全创建函数
function createCryptor() {
  try {
    return new WXBizMsgCrypt(token, encodingAESKey, corpId);
  } catch (e) {
    console.error("WXBizMsgCrypt init error:", e);
    return null;
  }
}

module.exports = async (req, res) => {
  // -----------------------------
  // ① 企业微信 URL 校验（GET 带 echostr）
  // -----------------------------
  if (req.method === "GET") {
    try {
      const { msg_signature, timestamp, nonce, echostr } = req.query || {};

      // 企业微信验证 URL 的 GET 请求：会带 echostr
      if (echostr) {
        const cryptor = createCryptor();

        if (cryptor) {
          try {
            // 按官方要求：先验签再解密，得到明文
            const echo = cryptor.verifyURL(
              msg_signature,
              timestamp,
              nonce,
              echostr
            );

            // 必须原样返回明文，不要加引号/JSON
            return res.status(200).type("text/plain").send(echo);
          } catch (e) {
            console.error("verifyURL error:", e);
            // 解密/验签失败：至少不要 500，先回原始 echostr
            return res.status(200).type("text/plain").send(echostr);
          }
        }

        // cryptor 初始化失败（比如 AESKey 长度不对），同样避免 500
        return res.status(200).type("text/plain").send(echostr);
      }

      // 普通 GET（你自己在浏览器打开 /api/quote）就简单回个 ok
      return res.status(200).type("text/plain").send("ok");
    } catch (e) {
      console.error("GET handler crashed:", e);
      return res.status(200).type("text/plain").send("error");
    }
  }

  // -----------------------------
  // ② 业务只接受 POST
  // -----------------------------
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST is allowed" });
  }

  // -----------------------------
  // ③ 解析 JSON body（兼容 raw 流）
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
      console.error("JSON parse error:", e);
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  // 从各种可能字段里抽取“型号”
  const model = (
    body.model ||                      // { model: "VF040..." }
    (body.text && body.text.content) ||// 企业微信 text 结构 { text: { content: "..." } }
    body.text ||                       // { text: "..." }
    ""
  ).trim();

  if (!model) {
    return res.status(400).json({ error: "缺少型号字段 model 或 text" });
  }

  // -----------------------------
  // ④ 调用本地报价引擎
  // -----------------------------
  let result;
  try {
    result = quote(model);
  } catch (e) {
    console.error("quote() crashed:", e);
    return res.status(500).json({ error: "quote engine error" });
  }

  // -----------------------------
  // ⑤ 报价失败 → 返回 markdown 错误消息
  // -----------------------------
  if (!result || !result.ok) {
    const reason = result && result.error ? result.error : "未知错误";

    const markdown = `❌ 报价失败

> 型号：\`${model}\`
> 原因：${reason}`;

    return res.status(200).json({
      msgtype: "markdown",
      markdown: { content: markdown },
      raw: {
        ok: false,
        model,
        message: reason
      }
    });
  }

  // -----------------------------
  // ⑥ 报价成功 → 返回 markdown 富文本
  // -----------------------------
  const markdown = `**${model} 报价结果**

- 工作表：\`${result.sheet}\`
- 单元格：列 \`${result.column}\`，行 \`${result.row}\`
- 欧元基础价：**€${result.base_price_eur}**
- 调整后欧元价：**€${result.adjusted_price_eur}**
- 人民币销售价：**¥${result.sales_price_cny}**

> 规则：${result.rule_applied}
> 公式：\`${result.rule_formula}\``;

  return res.status(200).json({
    // 企业微信真正要吃的部分
    msgtype: "markdown",
    markdown: {
      content: markdown
    },
    // 顺带把结构化数据也返回，方便以后其它系统复用
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
