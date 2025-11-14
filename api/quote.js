// api/quote.js

const crypto = require("crypto");
const WXBizMsgCrypt = require("wxcrypt");

// ======= 这里改成你自己的配置 =======
const TOKEN = "h5PEfU4TSE4I7mxLlDyFe9HrfwKp";
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj";
const CorpID = "wwaa053cf8eebf4f4a";
// ===================================

// 打一行日志，方便在 Vercel 看配置是否正确
console.log("WX config:", {
  token: TOKEN,
  aesLen: EncodingAESKey.length,
  corpId: CorpID,
});

// 先保留一个 cryptor，后面如果要加消息加密/解密还可以复用
const cryptor = new WXBizMsgCrypt(TOKEN, EncodingAESKey, CorpID);

/**
 * 只负责解密 echostr，不强制校验 corpId
 * 按企业微信官方文档的格式：
 * 16字节随机串 + 4字节msg长度 + 明文msg + corpId/appId
 */
function decryptEchoStr(echostr) {
  // 1. 还原 AES key & IV
  // 43 位 EncodingAESKey + "=" -> Base64 解出来刚好 32 字节 key
  const aesKey = Buffer.from(EncodingAESKey + "=", "base64");
  const iv = aesKey.slice(0, 16);

  // 2. Base64 解码密文
  const encrypted = Buffer.from(echostr, "base64");

  // 3. AES-256-CBC 解密（手动去 padding）
  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  // 4. 去掉 PKCS#7 补位
  const pad = decrypted[decrypted.length - 1];
  if (pad < 1 || pad > 32) {
    throw new Error("invalid padding");
  }
  decrypted = decrypted.slice(0, decrypted.length - pad);

  // 5. 跳过 16 字节随机串
  const content = decrypted.slice(16);

  // 6. 读出 4 字节长度，取出明文 msg
  const msgLen = content.readUInt32BE(0);
  const msgBuf = content.slice(4, 4 + msgLen);
  const msg = msgBuf.toString("utf8");

  // 7. 剩余部分是密文里附带的 corpId，我们只打印不强校验
  const realCorpId = content.slice(4 + msgLen).toString("utf8");
  console.log("Decrypted echostr corpId in ciphertext:", realCorpId);

  // 这个 msg 就是企业微信要我们返回的“明文 echostr”
  return msg;
}

module.exports = async function handler(req, res) {
  try {
    // ------------- ① URL 校验（GET）-------------
    if (req.method === "GET") {
      const { msg_signature, timestamp, nonce, echostr } = req.query || {};

      // 你自己在浏览器直接打开 /api/quote 时，没有 echostr，就回个 ok
      if (!echostr) {
        res.status(200).send("ok");
        return;
      }

      // 企业微信的验证请求：会带完整 4 个参数
      if (!msg_signature) {
        res.status(200).send("missing signature");
        return;
      }

      try {
        const plain = decryptEchoStr(echostr);
        res.setHeader("Content-Type", "text/plain");
        res.status(200).send(plain);
      } catch (err) {
        console.error("decryptEchoStr error:", err);
        // 解密失败也不要 500，原样返回 echostr，让企业微信给具体提示
        res.setHeader("Content-Type", "text/plain");
        res.status(200).send(echostr);
      }
      return;
    }

    // ------------- ② 收消息（POST）-------------
    if (req.method === "POST") {
      let xmlData = "";
      req.on("data", (chunk) => {
        xmlData += chunk;
      });
      req.on("end", () => {
        console.log("Received POST from WeCom:", xmlData);

        // 先返回一个简单的 markdown 欢迎语，确认链路打通
        res.setHeader("Content-Type", "application/xml");
        res.status(200).send(
          `
<xml>
  <MsgType><![CDATA[markdown]]></MsgType>
  <Markdown>
    <Content><![CDATA[**VF/VMP 报价助手已上线**\\n欢迎使用]]></Content>
  </Markdown>
</xml>
        `.trim()
        );
      });
      return;
    }

    // ------------- ③ 其它方法拒绝 -------------
    res.status(405).send("Only GET/POST allowed");
  } catch (e) {
    console.error("handler top-level error:", e);
    res.status(500).send("internal error");
  }
};
