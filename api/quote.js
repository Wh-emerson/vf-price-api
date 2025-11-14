// api/quote.js

const WXBizMsgCrypt = require("wxcrypt");

// 这三个请用你的真实值（建议先直接写死，调通再挪到环境变量里）
const TOKEN = "h5PEfU4TSE4I7mxLlDyFe9HrfwKp";
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj";
const CorpID = "wwaa053cf8eebf4f4a"; // ← 必须是企业ID，不是BotID

const cryptor = new WXBizMsgCrypt(TOKEN, EncodingAESKey, CorpID);

module.exports = async function handler(req, res) {
  try {
    const { method, url, query = {} } = req;
    const { msg_signature, timestamp, nonce, echostr } = query;

    console.log("WX config:", {
      token: TOKEN,
      aesLen: EncodingAESKey.length,
      receiveId: CorpID,
      method,
      path: url,
    });

    // -----------------------
    // 1. 企业微信的 URL 校验（GET）
    // -----------------------
    if (method === "GET") {
      // 你自己手动在浏览器打开 /api/quote?echostr=aaa 这种情况
      if (!msg_signature && echostr && echostr.length < 64) {
        res.status(200).send(echostr);
        return;
      }

      if (!echostr) {
        res.status(200).send("ok");
        return;
      }

      try {
        const decrypted = cryptor.verifyURL(
          msg_signature,
          timestamp,
          nonce,
          echostr
        );
        console.log("verifyURL ok, echostr decrypted:", decrypted);
        // 按官方要求，回明文字符串即可
        res.status(200).send(decrypted);
      } catch (err) {
        console.error("verifyURL error:", err);
        // 为了不让企业微信直接判死，返回原 echostr
        res.status(200).send(echostr);
      }
      return;
    }

    // -----------------------
    // 2. 接收并解密消息（POST）
    // -----------------------
    if (method === "POST") {
      let rawBody = "";
      req.on("data", (chunk) => (rawBody += chunk));
      req.on("end", () => {
        console.log("raw body:", rawBody);

        let encrypt;
        try {
          // 企业微信机器人发送的是 JSON：{"encrypt":"xxxxx"}
          const json = JSON.parse(rawBody || "{}");
          encrypt = json.encrypt;
        } catch (e) {
          console.error("JSON parse error:", e);
        }

        if (!encrypt) {
          console.error("no encrypt field in body");
          res.status(200).send("no encrypt");
          return;
        }

        // wxcrypt 只认 XML 里的 <Encrypt>，我们手动包一层
        const wrapXML = `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`;

        try {
          const decrypted = cryptor.decrypt(wrapXML);
          // decrypted 结构一般是 { message: 'xml字符串', id: 'CorpID' }
          console.log("decrypt success, message:", decrypted.message);

          // TODO: 这里可以把 decrypted.message 解析出来，接你的查价逻辑
          // 现在先简单回一条欢迎消息
          const replyXML = `
<xml>
  <MsgType><![CDATA[markdown]]></MsgType>
  <Markdown>
    <Content><![CDATA[**VF/VMP 报价助手已上线**\\n欢迎使用]]></Content>
  </Markdown>
</xml>`.trim();

          res.setHeader("Content-Type", "application/xml");
          res.status(200).send(replyXML);
        } catch (err) {
          console.error("decrypt error:", err);
          // 不要 500，企业微信会一直重试，先 200 告诉它“我收到了”
          res.status(200).send("decrypt error");
        }
      });
      return;
    }

    // 其它方法直接拒绝
    res.status(405).send("Only GET/POST allowed");
  } catch (e) {
    console.error("handler fatal error:", e);
    res.status(500).send("internal error");
  }
};
