// api/quote.js
// 企业微信「智能机器人」回调 & 被动回复
// 按官方《回调和回复的加解密方案》实现，全部 JSON，加解密用 Node 自带 crypto

const crypto = require("crypto");

// ===== 1. 这里填你机器人配置页上的 Token / EncodingAESKey =====
const TOKEN = "h5PEfU4TSE4I7mxLlDyFe9HrfwKp";
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj"; // 一定是 43 位
// 智能机器人场景：文档写的是 receiveid 传空字符串
const RECEIVE_ID = "";

// ===== 2. 签名计算 / 校验 =====
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
  const random16 = decrypted.slice(0, 16);
  const msgLen = decrypted.slice(16, 20).readUInt32BE(0);
  const msgBuf = decrypted.slice(20, 20 + msgLen);
  const msg = msgBuf.toString("utf8");
  const rest = decrypted.slice(20 + msgLen).toString("utf8"); // receiveId

  return { random16, msgLen, msg, receiveId: rest };
}

// ===== 5. 加密明文 JSON，返回 encrypt + msgsignature + timestamp + nonce =====
function encryptWeCom(plainJsonStr, nonceFromReq) {
  const key = aesKeyBuf();
  const iv = key.slice(0, 16);

  const random16 = crypto.randomBytes(16);
  const msgBuf = Buffer.from(plainJsonStr, "utf8");
  const msgLenBuf = Buffer.alloc(4);
  msgLenBuf.writeUInt32BE(msgBuf.length, 0);

  // 明文：16字节随机 + 4字节长度 + msg + receiveId（智能机器人这里是 ""）
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

  // timestamp / nonce / msgsignature
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
      // 你自己在浏览器打开 /api/quote?echostr=aaa 的情况
      if (!echostr) {
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
        // 官方推荐也返回 200，这里保守直接回原串
        res.status(200).send(echostr);
        return;
      }

      try {
        const { msg } = decryptWeCom(echostr);
        console.log("GET decrypt echostr success, msg:", msg);
        // 验证通过：直接返回 msg 明文
        res.status(200).send(msg);
      } catch (e) {
        console.error("GET decrypt echostr error:", e);
        res.status(200).send(echostr);
      }
      return;
    }

    // ---------- 6.2 接收消息 + 被动回复（POST） ----------
    if (method === "POST") {
      let bodyStr = "";
      req.on("data", (chunk) => (bodyStr += chunk));
      req.on("end", () => {
        (async () => {
          try {
            console.log("raw body:", bodyStr);

            // 1) 解析 encrypt
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

            // 2) 校验签名
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

            // 3) 解密得到明文 JSON 字符串
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

            // 4) 解析明文 JSON
            let eventObj;
            try {
              eventObj = JSON.parse(plainMsg);
            } catch (e) {
              console.error("plain msg is not valid JSON:", e);
              eventObj = {};
            }

            // 提取用户发来的文本
            let userText = "";
            if (
              eventObj.msgtype === "text" &&
              eventObj.text &&
              typeof eventObj.text.content === "string"
            ) {
              userText = eventObj.text.content;
            }

            // 5) 构造「明文回复」——先按官方说明带上 aibotid / chattype / from
            const replyPlainObj = {
              aibotid: eventObj.aibotid,
              chattype: eventObj.chattype,
              from: eventObj.from,
              msgtype: "text",
              text: {
                content: `你刚刚说：${userText || "(空内容)"}`,
              },
            };
            const replyPlainStr = JSON.stringify(replyPlainObj);
            console.log("reply plain:", replyPlainStr);

            // 6) 加密回复，生成 encrypt + msgsignature + timestamp + nonce
            const replyPacket = encryptWeCom(replyPlainStr, nonce);
            console.log("replyPacket:", replyPacket);

            // 自检：把刚才加密好的包再解密一遍，确认没有编码问题
            try {
              const check = decryptWeCom(replyPacket.encrypt);
              console.log("selfCheck decrypt of reply:", {
                msg: check.msg,
                receiveId: check.receiveId,
              });
            } catch (e) {
              console.error("selfCheck decrypt error:", e);
            }

            // 7) 按文档要求返回 JSON
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.status(200).send(replyPacket);
          } catch (e) {
            console.error("POST handler error:", e);
            // 出错也返回 200，避免企业微信疯狂重试
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
