// api/quote.js

const WXBizMsgCrypt = require("wxcrypt");

// 这三个值务必填成你「机器人详情页」里看到的那一套
// （就是你刚才截图的 Token / EncodingAESKey / 企业ID）
const TOKEN = "h5PEfU4TSE4I7mxLlDyFe9HrfwKp";
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj";
const CorpID = "wwaa053cf8eebf4f4a";

const cryptor = new WXBizMsgCrypt(TOKEN, EncodingAESKey, CorpID);

// 简单取 CDATA 的辅助函数
function getCData(xml, tag) {
  const re = new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>`);
  const m = xml.match(re);
  return m ? m[1] : "";
}

module.exports = async function handler(req, res) {
  try {
    // ---------- 1. 企业微信 URL 校验（GET） ----------
    if (req.method === "GET") {
      const { msg_signature, timestamp, nonce, echostr } = req.query || {};

      // 你在浏览器自己点开测试时是没有这些参数的，这种情况直接返回 ok
      if (!echostr) {
        res.status(200).send("ok");
        return;
      }

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
        // 按官方要求，返回「解密后的 echostr 明文」
        res.setHeader("Content-Type", "text/plain");
        res.status(200).send(decrypted);
      } catch (err) {
        console.error("verifyURL error:", err);
        // URL 校验失败时，官方建议也 200，把原 echostr 返回回去
        res.setHeader("Content-Type", "text/plain");
        res.status(200).send(echostr || "");
      }
      return;
    }

    // ---------- 2. 收到成员发给机器人的消息（POST） ----------
    if (req.method === "POST") {
      const { msg_signature, timestamp, nonce } = req.query || {};

      let xmlData = "";
      req.on("data", (chunk) => (xmlData += chunk));
      req.on("end", () => {
        (async () => {
          try {
            // 2.1 解密收到的消息
            const decryptedXml = cryptor.decryptMsg(
              msg_signature,
              timestamp,
              nonce,
              xmlData
            );

            // 2.2 从明文 XML 里取一些关键信息
            const fromUser = getCData(decryptedXml, "FromUserName"); // 谁发的
            const toUser = getCData(decryptedXml, "ToUserName");     // 发给谁
            const content = getCData(decryptedXml, "Content");       // 文本内容，群聊时可能为空

            console.log("收到消息：", { fromUser, toUser, content });

            // 2.3 构造「明文回复 XML」
            // 注意：被动回复里，要把 To / From 反过来
            const now = Math.floor(Date.now() / 1000);
            const replyMarkdown =
              `**VF/VMP 报价助手已上线**\n` +
              `你刚才发送：${content || "[非文本消息]"}`;

            const replyPlainXml = `
<xml>
  <ToUserName><![CDATA[${fromUser}]]></ToUserName>
  <FromUserName><![CDATA[${toUser}]]></FromUserName>
  <CreateTime>${now}</CreateTime>
  <MsgType><![CDATA[markdown]]></MsgType>
  <Markdown>
    <Content><![CDATA[${replyMarkdown}]]></Content>
  </Markdown>
</xml>`.trim();

            // 2.4 使用加密库加密回复 XML，生成「带 Encrypt/MsgSignature 的最终 XML」
            const encryptedXml = cryptor.encryptMsg(
              replyPlainXml,
              timestamp,
              nonce
            );

            res.setHeader("Content-Type", "application/xml");
            res.status(200).send(encryptedXml);
          } catch (err) {
            console.error("POST decrypt/encrypt error:", err);
            // 出错时至少返回 200，避免企业微信重复推送
            res.status(200).send("success");
          }
        })();
      });

      return;
    }

    // 其它 HTTP 方法不支持
    res.status(405).send("Only GET/POST allowed");
  } catch (e) {
    console.error(e);
    res.status(500).send("internal error");
  }
};
