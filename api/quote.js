// api/quote.js

const WXBizMsgCrypt = require("wxcrypt");

// 这里填「机器人配置详情」里的三样东西
const TOKEN = "aibJ_SKLyZIzZTlq6lN1sY_lpTKSCZNsGaF";
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj";
const CorpID = "wwaa053cf8eebf4f4a";

const cryptor = new WXBizMsgCrypt(TOKEN, EncodingAESKey, CorpID);

// 简单打个日志，确认配置有没有填对长度
console.log("WX config:", {
  token: TOKEN,
  aesLen: EncodingAESKey.length,
  corpId: CorpID
});

module.exports = async function handler(req, res) {
  try {
    // ---- 1. URL 校验（GET） ----
    if (req.method === "GET") {
      const { msg_signature, timestamp, nonce, echostr } = req.query || {};

      // 你自己在浏览器里敲 ?echostr=aaa 测试的情况：直接回 ok 就行
      if (!echostr) {
        res.status(200).send("ok");
        return;
      }

      // 企业微信真正的校验请求会带上 4 个参数
      if (!msg_signature || !timestamp || !nonce) {
        res.status(200).send(echostr);
        return;
      }

      try {
        const decrypted = cryptor.verifyURL(
          msg_signature,
          timestamp,
          nonce,
          echostr
        );
        // 正常情况，把解出来的明文 echostr 回给企业微信
        res.setHeader("Content-Type", "text/plain");
        res.status(200).send(decrypted);
      } catch (err) {
        console.error("verifyURL error:", err);
        // 校验失败时，企业微信官方建议仍然 200 + 原始 echostr
        res.setHeader("Content-Type", "text/plain");
        res.status(200).send(echostr);
      }
      return;
    }

    // ---- 2. 收消息 + 被动回复（POST） ----
    if (req.method === "POST") {
      const { msg_signature, timestamp, nonce } = req.query || {};

      let xmlData = "";
      req.on("data", (chunk) => (xmlData += chunk));
      req.on("end", () => {
        console.log("raw xml:", xmlData);

        // 2.1 先解密收到的消息
        let msg;
        try {
          msg = cryptor.decryptMsg(
            msg_signature,
            timestamp,
            nonce,
            xmlData
          );
          console.log("decrypted msg:", msg);
        } catch (err) {
          console.error("decryptMsg error:", err);
          // 解密失败也要回 200，避免企业微信一直重试
          res.status(200).send("success");
          return;
        }

        const now = Math.floor(Date.now() / 1000);

        // 企业微信的规范：被动回复时，要把 From/To 互换
        const toUser = msg.FromUserName;   // 谁发来的
        const fromUser = msg.ToUserName;   // 机器人这边的标识（企业ID / BotID）

        // 2.2 构造「明文回复」——先按官方 XML 协议写好
        const plainReply =
          `<xml>` +
          `<ToUserName><![CDATA[${toUser}]]></ToUserName>` +
          `<FromUserName><![CDATA[${fromUser}]]></FromUserName>` +
          `<CreateTime>${now}</CreateTime>` +
          `<MsgType><![CDATA[markdown]]></MsgType>` +
          `<Markdown>` +
          `<Content><![CDATA[**VF/VMP 报价助手已上线**\n你刚才说：${msg.Content || ""}]]></Content>` +
          `</Markdown>` +
          `</xml>`;

        // 2.3 使用 wxcrypt 加密回复
        let encrypted;
        try {
          // 大多数实现是 encryptMsg(plainXml, timestamp, nonce)
          encrypted = cryptor.encryptMsg(plainReply, timestamp, nonce);
        } catch (err) {
          console.error("encryptMsg error:", err);
          res.status(200).send("success");
          return;
        }

        let finalXml;

        // 兼容两种返回形式：字符串 / 对象
        if (typeof encrypted === "string") {
          // 有些库直接返回完整的 <xml>...</xml>
          finalXml = encrypted;
        } else if (encrypted && encrypted.encrypt && encrypted.msg_signature) {
          const ts = encrypted.timestamp || timestamp;
          const nc = encrypted.nonce || nonce;
          finalXml =
            `<xml>` +
            `<Encrypt><![CDATA[${encrypted.encrypt}]]></Encrypt>` +
            `<MsgSignature><![CDATA[${encrypted.msg_signature}]]></MsgSignature>` +
            `<TimeStamp>${ts}</TimeStamp>` +
            `<Nonce><![CDATA[${nc}]]></Nonce>` +
            `</xml>`;
        } else {
          console.error("unexpected encryptMsg result:", encrypted);
          res.status(200).send("success");
          return;
        }

        // 2.4 把加密后的 XML 回给企业微信
        res.setHeader("Content-Type", "application/xml");
        res.status(200).send(finalXml);
      });

      return;
    }

    // ---- 3. 其它方法不支持 ----
    res.status(405).send("Only GET/POST allowed");
  } catch (e) {
    console.error(e);
    res.status(500).send("internal error");
  }
};
