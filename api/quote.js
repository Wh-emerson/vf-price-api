const WXBizMsgCrypt = require("wxcrypt");

const TOKEN = "h5PEfU4TSE4I7mxLlDyFe9HrfwKp";
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj";
const CorpID = "wwaa053cf8eebf4f4a";

const cryptor = new WXBizMsgCrypt(TOKEN, EncodingAESKey, CorpID);

module.exports = async function handler(req, res) {
  try {
    //
    // -----------------------
    // 1) 企业微信验证（GET）
    // -----------------------
    //
    if (req.method === "GET") {
      const { msg_signature, timestamp, nonce, echostr } = req.query || {};

      // 浏览器直接访问（没有 echostr）
      if (!echostr) {
        res.status(200).send("ok");
        return;
      }

      // 企业微信验证
      try {
        const decrypted = cryptor.verifyURL(
          msg_signature,
          timestamp,
          nonce,
          echostr
        );
        res.status(200).send(decrypted);
      } catch (err) {
        console.error("verifyURL error:", err);
        res.status(200).send(echostr);
      }
      return;
    }

    //
    // -----------------------
    // 2) 企业微信推送消息（POST）
    // -----------------------
    //
    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", () => {
        console.log("raw body:", body);

        // 机器人推送是 JSON，不是 XML！
        let json;
        try {
          json = JSON.parse(body);
        } catch (e) {
          console.error("JSON parse error:", e);
          res.status(200).send("invalid json");
          return;
        }

        const encrypt = json.encrypt;
        if (!encrypt) {
          res.status(200).send("missing encrypt");
          return;
        }

        // 解密消息
        let decrypted;
        try {
          decrypted = cryptor.decrypt(encrypt);
        } catch (e) {
          console.error("decrypt error:", e);
          res.status(200).send("decrypt failed");
          return;
        }

        console.log("decrypted:", decrypted);

        //
        // 给企业微信回复 Markdown（无需加密）
        //
        res.setHeader("Content-Type", "application/json");
        res.status(200).send({
          msgtype: "markdown",
          markdown: {
            content: "**VF/VMP 报价助手已上线**\n你的消息已收到！"
          }
        });
      });

      return;
    }

    res.status(405).send("Only GET/POST allowed");
  } catch (e) {
    console.error(e);
    res.status(500).send("Internal error");
  }
};
