// api/quote.js
// 智能机器人回调 + 被动回复，按官方“回调和回复的加解密方案”实现
// 全程 JSON，加解密自己用 crypto 实现

const crypto = require("crypto");

// ====== 1. 填你机器人页面上的 Token / EncodingAESKey ======
const TOKEN = "h5PEfU4TSE4I7mxLlDyFe9HrfwKp";
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj"; // 不要少字符
// 智能机器人场景，官方文档明确：ReceiveId 为空字符串 ""
const RECEIVE_ID = "";

// ====== 2. 工具函数：签名校验 ======
function calcSignature(token, timestamp, nonce, encrypt) {
  const arr = [token, timestamp, nonce, encrypt].sort();
  const sha1 = crypto.createHash("sha1");
  sha1.update(arr.join(""));
  return sha1.digest("hex");
}

function verifySignature(token, timestamp, nonce, encrypt, msgSignature) {
  const sig = calcSignature(token, timestamp, nonce, encrypt);
  return sig === msgSignature;
}

// ====== 3. 工具函数：PKCS#7 补位/去补位 ======
function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) {
    throw new Error("invalid padding");
  }
  return buf.slice(0, buf.length - pad);
}

function pkcs7Pad(buf) {
  const blockSize = 32;
  const pad = blockSize - (buf.length % blockSize || blockSize);
  const padBuf = Buffer.alloc(pad, pad);
  return Buffer.concat([buf, padBuf]);
}

// ====== 4. 解密 encrypt / echostr，按企业微信算法 ======
function aesKeyBuf() {
  // EncodingAESKey 43 位，需要加一个 "=" 变成标准 Base64
  return Buffer.from(EncodingAESKey + "=", "base64");
}

function decryptWeCom(encrypt) {
  const key = aesKeyBuf();
  const iv = key.slice(0, 16);

  const cipherText = Buffer.from(encrypt, "base64");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);

  let decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  decrypted = pkcs7Unpad(decrypted);

  // 结构：16字节随机串 + 4字节msg_len + msg + receiveId
  const random16 = decrypted.slice(0, 16);
  const msgLen = decrypted.slice(16, 20).readUInt32BE(0);
  const msgBuf = decrypted.slice(20, 20 + msgLen);
  const msg = msgBuf.toString("utf8");
  const rest = decrypted.slice(20 + msgLen).toString("utf8"); // receiveId（这里应为空或无视）

  return { random16, msgLen, msg, receiveId: rest };
}

// ====== 5. 加密明文 JSON 回复，返回 encrypt + msgsignature + timestamp + nonce ======
function encryptWeCom(plainJsonStr, nonceFromReq) {
  const key = aesKeyBuf();
  const iv = key.slice(0, 16);

  const random16 = crypto.randomBytes(16);
  const msgBuf = Buffer.from(plainJsonStr, "utf8");
  const msgLenBuf = Buffer.alloc(4);
  msgLenBuf.writeUInt32BE(msgBuf.length, 0);

  // 明文：16字节随机 + 4字节长度 + msg + receiveId(空字符串)
  const plainBuf = Buffer.concat([
    random16,
    msgLenBuf,
    msgBuf,
    Buffer.from(RECEIVE_ID, "utf8"),
  ]);

  const padded = pkcs7Pad(plainBuf);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  const encryptedBuf = Buffer.concat([cipher.update(padded), cipher.final()]);
  const encrypt = encryptedBuf.toString("base64");

  // timestamp/nonce & msgsignature
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = nonceFromReq || crypto.randomBytes(8).toString("hex");
  const msgsignature = calcSignature(TOKEN, timestamp, nonce, encrypt);

  return {
    encrypt,
    msgsignature,
    timestamp,
    nonce,
  };
}

// ====== 6. Vercel Handler ======
module.exports = async function handler(req, res) {
  try {
    const { method, url, query = {} } = req;
    const { msg_signature, timestamp, nonce, echostr } = query;

    console.log("Incoming:", { method, url, query });

    // -------- 6.1 URL 验证（GET） --------
    if (method === "GET") {
      if (!echostr) {
        res.status(200).send("ok");
        return;
      }

      // 先验签，再解密 echostr
      if (!msg_signature || !timestamp || !nonce) {
        console.error("GET missing signature params");
        res.status(200).send(echostr);
        return;
      }

      const ok = verifySignature(TOKEN, timestamp, nonce, echostr, msg_signature);
      if (!ok) {
        console.error("GET verify signature failed");
        // 文档建议仍然 200 返回明文/原串，这里保守一点直接原样回
        res.status(200).send(echostr);
        return;
      }

      try {
        const { msg } = decryptWeCom(echostr);
        console.log("GET decrypt echostr success, msg:", msg);
        // 按文档：直接返回 msg（明文）
        res.status(200).send(msg);
      } catch (e) {
        console.error("GET decrypt echostr error:", e);
        res.status(200).send(echostr);
      }
      return;
    }

    // -------- 6.2 接收消息 + 被动回复（POST） --------
    // 假设前面的部分已经：
    // 1. 使用 WXBizMsgCrypt 实例 cryptor
    // 2. 从 query 里取到 msg_signature / timestamp / nonce
    // 3. 把 body 解密成明文字符串 plainText

    if (req.method === "POST") {
      let rawBody = "";
      req.on("data", chunk => (rawBody += chunk));
      req.on("end", () => {
        try {
          console.log("raw body:", rawBody);

          // 1. 解密收到的 encrypt
          const parsed = JSON.parse(rawBody);
          const encrypt = parsed.encrypt;
          const { msg_signature, timestamp, nonce } = req.query;

          console.log("WX config:", {
            token: TOKEN,
            aesLen: EncodingAESKey.length,
            receiveId: "", // 智能机器人场景下是空字符串
            method: req.method,
            path: req.url,
            query: req.query
          });

          const plain = cryptor.decrypt(
            msg_signature,
            timestamp,
            nonce,
            encrypt
          );

          console.log("decrypt success, plain msg:", plain);

          const eventObj = JSON.parse(plain);  // 企微发来的明文 JSON

          // 2. 这里先做一个最小可用文本回复
          let userText = "";
          if (eventObj.msgtype === "text" && eventObj.text && eventObj.text.content) {
            userText = eventObj.text.content;
          }

          const replyPlainObj = {
            msgtype: "text",
            text: {
              // 纯文本先别搞 Markdown，先确认走通
              content: `你刚刚说：${userText || "(空内容)"}`
            }
          };

          const replyPlainStr = JSON.stringify(replyPlainObj);
          console.log("reply plain:", replyPlainStr);

          // 3. 加密回复
          const encryptReply = cryptor.encrypt(replyPlainStr);
          const msgSignatureReply = cryptor.getSignature(
            timestamp,
            nonce,
            encryptReply
          );

          const replyPacket = {
            encrypt: encryptReply,
            msgsignature: msgSignatureReply,
            timestamp,
            nonce
          };

          console.log("reply packet:", replyPacket);

          // 4. 返回给企微（被动回复）
          res.setHeader("Content-Type", "application/json");
          res.status(200).end(JSON.stringify(replyPacket));
        } catch (e) {
          console.error("POST handler error:", e);
          // 即便出错也尽量返回 200，避免企微一直重试
          res.status(200).end("");
        }
      });

      return;
    }


    // 其它方法不支持
    res.status(405).send("Only GET/POST allowed");
  } catch (e) {
    console.error("handler fatal error:", e);
    res.status(500).send("internal error");
  }
};
