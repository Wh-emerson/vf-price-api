const WXBizMsgCrypt = require("wxcrypt");
const { o2x, x2o } = require("wxcrypt");

const TOKEN = "h5PEfU4TSE4I7mxLlDyFe9HrfwKp";
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj";
const CorpID = "wwaa053cf8eebf4f4a";

const cryptor = new WXBizMsgCrypt(TOKEN, EncodingAESKey, CorpID);

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { msg_signature, timestamp, nonce, echostr } = req.query || {};

      // 你在浏览器手动打开 ?echostr=aaa 这种，只会带 echostr，属于自测
      if (!echostr) {
        res.status(200).send("ok");
        return;
      }

      // 企业微信的校验请求，一定会带 4 个参数
      if (!msg_signature || !timestamp || !nonce) {
        res.status(400).send("missing signature");
        return;
      }

      try {
        const decrypted = cryptor.verifyURL(
          msg_signature,
          timestamp,
          nonce,
          echostr
        );
        res.setHeader("Content-Type", "text/plain");
        res.status(200).send(decrypted); // 必须原样返回
      } catch (err) {
        console.error("verifyURL error:", err);
        // 这里不要再硬回 echostr 作弊了，让它失败你才能发现问题
        res.status(500).send("verify failed");
      }
      return;
    }


    //
    // -----------------------
    // 2) 企业微信推送消息（POST）
    // -----------------------
    //
    if (req.method === "POST") {
      const { msg_signature, timestamp, nonce } = req.query || {};

      let raw = "";
      req.on("data", chunk => (raw += chunk));
      req.on("end", () => {
        console.log("raw body:", raw);

        let encrypt;
        try {
          const json = JSON.parse(raw);
          encrypt = json.encrypt;
        } catch (e) {
          console.error("JSON parse error:", e);
          res.status(400).send("bad json");
          return;
        }

        if (!msg_signature || !timestamp || !nonce || !encrypt) {
          console.error("missing wx params");
          res.status(400).send("missing wx params");
          return;
        }

        // 拼成 wxcrypt 需要的 xml
        const xml = `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`;

        let decryptedXml;
        try {
          decryptedXml = cryptor.decryptMsg(
            msg_signature,
            timestamp,
            nonce,
            xml
          );
          console.log("decrypted xml:", decryptedXml);
        } catch (err) {
          console.error("decryptMsg error:", err);
          // 这里再看到 -40001，就肯定是三件套不一致
          res.status(200).send("decrypt failed");
          return;
        }

        // 先不细分字段，直接固定回一条 markdown 消息
        const msg = x2o(decryptedXml).xml;

        const replyObj = {
          xml: {
            ToUserName: msg.FromUserName,
            FromUserName: msg.ToUserName,
            CreateTime: Math.floor(Date.now() / 1000),
            MsgType: "markdown",
            Markdown: {
              Content:
                "**VF/VMP 报价助手已上线**\\n" +
                "你发的内容我已经收到，稍后就会支持查价。"
            }
          }
        };

        const replyPlainXml = o2x(replyObj);

        // 加密回复
        const encryptedReply = cryptor.encryptMsg(
          replyPlainXml,
          String(timestamp),
          String(nonce)
        );

        res.setHeader("Content-Type", "application/xml");
        res.status(200).send(encryptedReply);
      });

      return;
    }

    res.status(405).send("Only GET/POST allowed");
  } catch (e) {
    console.error(e);
    res.status(500).send("internal error");
  }
};

