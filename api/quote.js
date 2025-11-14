const WXBizMsgCrypt = require("wxcrypt");

const TOKEN = "N3bMPFEvqNUNnWubCo";
const EncodingAESKey = "3qmvKLU2oBQMAk36ftJJtgMe01IBFwEmD9YzJhDwI61";
const CorpID = "wwaa053cf8eebf4f4a";

const cryptor = new WXBizMsgCrypt(TOKEN, EncodingAESKey, CorpID);

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
  const { msg_signature, timestamp, nonce, echostr } = req.query || {};

  // 没带 echostr，多半是你自己在浏览器测试，直接回 OK
  if (!echostr) {
    res.status(200).send("ok");
    return;
  }

  // 企业微信的验证请求：会带完整的 4 个参数
  if (!msg_signature) {
    // 参数不完整，也不要 500，给个说明就行
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
    res.setHeader("Content-Type", "text/plain");
    res.status(200).send(decrypted);
  } catch (err) {
    console.error("verifyURL error:", err);
    // ❗注意：这里也用 200，不要 500
    // 返回原始 echostr，让企业微信自己判断“校验失败”
    res.setHeader("Content-Type", "text/plain");
    res.status(200).send(echostr);
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
