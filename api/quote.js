// api/quote.js

// 1. 引入企业微信加解密库
const WXBizMsgCrypt = require("wxcrypt");

// 2. 把下面三个值改成【机器人详情页】里的配置：
//   Token           -> TOKEN
//   EncodingAESKey  -> EncodingAESKey
//   Bot ID          -> RECEIVE_ID  （注意：是 Bot ID，不是企业ID！）
const TOKEN = "h5PEfU4TSE4I7mxLlDyFe9HrfwKp";
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj";
const RECEIVE_ID = "aibJ_SKLyZIzZTlq6lN1sY_lpTKSCZNsGaF"; // 机器人详情页里的 Bot ID

// 3. 只保留一个全局 cryptor
const cryptor = new WXBizMsgCrypt(TOKEN, EncodingAESKey, RECEIVE_ID);

// 4. Vercel Serverless 入口
module.exports = async function handler(req, res) {
  try {
    // --- 方便排错：打印一下当前配置（长度，不打印明文AESKey） ---
    console.log("WX config:", {
      token: TOKEN,
      aesLen: EncodingAESKey.length,
      receiveId: RECEIVE_ID,
      method: req.method,
      path: req.url,
    });

    // ================================
    //  A. 企业微信服务器首次 GET 校验
    // ================================
    if (req.method === "GET") {
      const { msg_signature, timestamp, nonce, echostr } = req.query || {};

      // 你在浏览器里随便打开 ?echostr=aaa 的情况
      if (!echostr) {
        res.status(200).send("ok");
        return;
      }

      // 企业微信正式的校验请求：必须带 msg_signature
      if (!msg_signature) {
        res.status(200).send("missing signature");
        return;
      }

      try {
        const decrypted = cryptor.verifyURL(
          msg_signature,
          timestamp,
          nonce,
          echostr
        );
        // 正常情况下返回明文 echostr
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.status(200).send(decrypted);
      } catch (err) {
        console.error("verifyURL error:", err);
        // 文档推荐：即便校验失败，也返回原始 echostr，状态码 200
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.status(200).send(echostr);
      }
      return;
    }

    // ================================
    //  B. 企业微信推送消息（POST）
    // ================================
    if (req.method === "POST") {
  let xmlData = "";
  req.on("data", chunk => (xmlData += chunk));
  req.on("end", () => {
    try {
      const json = JSON.parse(xmlData);   // 企业微信机器人 POST 的内容
      const encrypted = json.encrypt;

      // 转成 wxcrypt 需要的 XML 格式
      const wrapXML = `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`;

      const decrypted = cryptor.decrypt(wrapXML);
      console.log("decrypted:", decrypted.message);

      res.setHeader("Content-Type", "application/xml");
      res.status(200).send(`
<xml>
  <MsgType><![CDATA[markdown]]></MsgType>
  <Markdown>
    <Content><![CDATA[**VF/VMP 报价助手已上线**\n欢迎使用]]></Content>
  </Markdown>
</xml>
      `.trim());
    } catch (err) {
      console.error("decrypt error:", err);
      res.status(200).send("decrypt failed");
    }
  });
  return;
}


    // 其它方法一律 405
    res.status(405).send("Only GET/POST allowed");
  } catch (e) {
    console.error("internal error:", e);
    // 对企业微信来说，最好也返回 200，避免拉黑；这里只留着调试用
    res.status(200).send("success");
  }
};
