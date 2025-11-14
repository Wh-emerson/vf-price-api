const WXBizMsgCrypt = require("wxcrypt");

const TOKEN = "K2LeJSeltY";
const EncodingAESKey = "6OGfGpr8vnhWakDjPjgwOLFpBPUBCxzN6qNIOxc0OwJ";
const CorpID = "wwaa053cf8eebf4f4a";

const cryptor = new WXBizMsgCrypt(TOKEN, EncodingAESKey, CorpID);

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { msg_signature, timestamp, nonce, echostr } = req.query;

      if (!msg_signature) {
        res.status(400).send("missing signature");
        return;
      }

      try {
        const decrypted = cryptor.verifyURL(msg_signature, timestamp, nonce, echostr);
        res.setHeader("Content-Type", "text/plain");
        res.status(200).send(decrypted);
      } catch (err) {
        console.error("verifyURL error:", err);
        res.status(500).send("verifyURL failed: " + err.errmsg);
      }
      return;
    }

    if (req.method === "POST") {
      let xmlData = "";
      req.on("data", chunk => (xmlData += chunk));
      req.on("end", () => {
        res.setHeader("Content-Type", "application/xml");
        res.status(200).send(`
<xml>
  <MsgType><![CDATA[markdown]]></MsgType>
  <Markdown>
    <Content><![CDATA[**VF/VMP 报价助手已上线**\n欢迎使用]]></Content>
  </Markdown>
</xml>
        `.trim());
      });
      return;
    }

    res.status(405).send("Only GET/POST allowed");
  } catch (e) {
    console.error(e);
    res.status(500).send("internal error");
  }
};
