// api/quote.js
// 企业微信「内部智能机器人 · API 模式」回调（按官方 Python3 Demo JSON 版重写）
// 功能：
// 1）GET 用于 URL 校验（解密 echostr 返回明文）
// 2）POST 解密收到的 JSON，读取用户文本，按 msgtype=stream 结构回复
// 全程只用到 Token + EncodingAESKey，不需要 corpsecret / send_url / access_token

const crypto = require("crypto");

// ===== 1. 机器人回调配置 =====
// 请改成你机器人配置页中看到的 Token / EncodingAESKey
const TOKEN = "h5PEfU4TSE4I7mxLlDyFe9HrfwKp";
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj"; // 必须是 43 位
// 智能机器人场景 receiveid 为空字符串（官方说明）
const RECEIVE_ID = "";

// ===== 2. 签名计算 / 校验（完全沿用你之前的逻辑） =====
function calcSignature(token, timestamp, nonce, encrypt) {
  const arr = [token, timestamp, nonce, encrypt].sort();
  return crypto.createHash("sha1").update(arr.join("")).digest("hex");
}

function verifySignature(token, timestamp, nonce, encrypt, msgSignature) {
  const sig = calcSignature(token, timestamp, nonce, encrypt);
  return sig === msgSignature;
}

// ===== 3. PKCS#7 补位 / 去补位 =====
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

// ===== 4. AES key / 解密 encrypt/echostr =====
function aesKeyBuf() {
  // EncodingAESKey 43 位，要补一个 "=" 再按 base64 解
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

  // 明文结构：16字节随机串 + 4字节msg_len + msg + receiveId
  const msgLen = decrypted.slice(16, 20).readUInt32BE(0);
  const msgBuf = decrypted.slice(20, 20 + msgLen);
  const msg = msgBuf.toString("utf8");
  const rest = decrypted.slice(20 + msgLen).toString("utf8"); // receiveId

  return { msg, receiveId: rest };
}

// ===== 5. 加密明文 JSON，生成 encrypt + msgsignature + timestamp + nonce =====
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

// ===== 6. Vercel Handler =====
module.exports = async function handler(req, res) {
  try {
    const { method, url, query = {} } = req;
    const { msg_signature, timestamp, nonce, echostr } = query;

    console.log("Incoming:", { method, url, query });

    // ---------- 6.1 URL 验证（GET） ----------
    if (method === "GET") {
      if (!echostr) {
        // 你自己浏览器打开 /api/quote?xxx 的情况
        res.status(200).send("ok");
        return;
      }

      if (!msg_signature || !timestamp || !nonce) {
        console.error("GET missing signature params");
        res.status(200).send(echostr);
        return;
      }

      const ok = verifySignature(TOKEN, timestamp, nonce, echostr, msg_signature);
      if (!ok) {
        console.error("GET verify signature failed");
        // 按官方建议：仍然 200 返回原串
        res.status(200).send(echostr);
        return;
      }

      try {
        const { msg } = decryptWeCom(echostr);
        console.log("GET decrypt echostr success, msg:", msg);
        // 验证通过，按文档返回明文 msg
        res.status(200).send(msg);
      } catch (e) {
        console.error("GET decrypt echostr error:", e);
        res.status(200).send(echostr);
      }
      return;
    }

    // ---------- 6.2 接收消息（POST） ----------
    if (method === "POST") {
      let bodyStr = "";
      req.on("data", (chunk) => (bodyStr += chunk));
      req.on("end", () => {
        (async () => {
          try {
            console.log("raw body:", bodyStr);

            let encrypt;
            try {
              const json = JSON.parse(bodyStr || "{}");
              encrypt = json.encrypt;
            } catch (e) {
              console.error("POST JSON parse error:", e);
              res.status(200).send("invalid json");
              return;
            }

            if (!encrypt) {
              console.error("POST missing encrypt");
              res.status(200).send("missing encrypt");
              return;
            }

            if (!msg_signature || !timestamp || !nonce) {
              console.error("POST missing signature params");
              res.status(200).send("missing signature");
              return;
            }

            // 1）校验签名
            const ok = verifySignature(
              TOKEN,
              timestamp,
              nonce,
              encrypt,
              msg_signature
            );
            if (!ok) {
              console.error("POST verify signature failed");
              res.status(200).send("sig error");
              return;
            }

            // 2）解密得到明文 JSON
            let plainMsg;
            try {
              const { msg } = decryptWeCom(encrypt);
              plainMsg = msg;
              console.log("decrypt success, plain msg:", plainMsg);
            } catch (e) {
              console.error("decrypt error:", e);
              res.status(200).send("decrypt error");
              return;
            }

            // 3）解析事件 JSON（用户发来的消息）
            let eventObj = {};
            try {
              eventObj = JSON.parse(plainMsg);
            } catch (e) {
              console.error("plain msg is not valid JSON:", e);
              eventObj = {};
            }

            // 4）拿到用户发来的文本
            let userText = "";
            if (
              eventObj.msgtype === "text" &&
              eventObj.text &&
              typeof eventObj.text.content === "string"
            ) {
              userText = eventObj.text.content;
            }

            // ===== 关键：构造 stream 类型的明文回复（对齐官方 MakeTextStream） =====
            const streamId =
              eventObj.msgid ||
              (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString("hex"));
            const finish = true;

            const replyPlainObj = {
              msgtype: "stream",
              stream: {
                id: streamId,
                finish,
                content: `你刚刚说：${userText || "(空内容)"}`,
              },
            };

            const replyPlainStr = JSON.stringify(replyPlainObj);
            console.log("reply plain (stream):", replyPlainStr);

            // 5）对明文回复进行加密，生成 encrypt + msgsignature + timestamp + nonce
            const replyPacket = encryptWeCom(replyPlainStr, nonce);
            console.log("replyPacket:", replyPacket);

            // 6）按官方 demo，用 text/plain 返回 JSON 字符串
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.status(200).send(JSON.stringify(replyPacket));
          } catch (e) {
            console.error("POST handler error:", e);
            // 即便出错也尽量返回 200，避免企微一直重试
            res.status(200).send("");
          }
        })();
      });
      return;
    }

    // 其它方法
    res.status(405).send("Only GET/POST allowed");
  } catch (e) {
    console.error("handler fatal error:", e);
    res.status(500).send("internal error");
  }
};
