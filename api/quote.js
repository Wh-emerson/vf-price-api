// api/quote.js
// 企业微信「智能机器人 · API 模式」回调 + 被动回复
// 全程 JSON 加解密（按《回调和回复的加解密方案》）
// --- 填好 TOKEN / EncodingAESKey 后直接部署 ---

const crypto = require("crypto");

// ===== 1. 填你机器人的 Token / EncodingAESKey =================
const TOKEN = "h5PEfU4TSE4I7mxLlDyFe9HrfwKp";              // <- 换成你的
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj"; // <- 换成你的（43 位）
const RECEIVE_ID = ""; // 文档：企业内部智能机器人场景 receiveid 为空字符串

// ===== 2. 签名相关 =================================================
function calcSignature(token, timestamp, nonce, encrypt) {
  const arr = [token, timestamp, nonce, encrypt].sort();
  return crypto.createHash("sha1").update(arr.join("")).digest("hex");
}

function verifySignature(token, timestamp, nonce, encrypt, msgSignature) {
  const sig = calcSignature(token, timestamp, nonce, encrypt);
  return sig === msgSignature;
}

// ===== 3. PKCS7 补位 / 去补位 ======================================
function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) throw new Error("invalid padding");
  return buf.slice(0, buf.length - pad);
}

function pkcs7Pad(buf) {
  const blockSize = 32;
  const pad = blockSize - (buf.length % blockSize || blockSize);
  return Buffer.concat([buf, Buffer.alloc(pad, pad)]);
}

// ===== 4. AES key / 解密函数 =======================================
function aesKeyBuf() {
  // EncodingAESKey 43 字节，后面补一个 "=" 变成合法 base64
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

  // 16 随机 + 4 长度 + msg + receiveId
  const msgLen = decrypted.slice(16, 20).readUInt32BE(0);
  const msgBuf = decrypted.slice(20, 20 + msgLen);
  const msg = msgBuf.toString("utf8");
  const rest = decrypted.slice(20 + msgLen).toString("utf8");

  return {
    msg,
    receiveId: rest,
  };
}

// ===== 5. 加密回复 ==================================================
function encryptWeCom(plainJsonStr, nonceFromReq) {
  const key = aesKeyBuf();
  const iv = key.slice(0, 16);

  const random16 = crypto.randomBytes(16);
  const msgBuf = Buffer.from(plainJsonStr, "utf8");
  const msgLenBuf = Buffer.alloc(4);
  msgLenBuf.writeUInt32BE(msgBuf.length, 0);

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

// ===== 6. Vercel Handler ===========================================
module.exports = async function handler(req, res) {
  try {
    const { method, url, query = {} } = req;
    // Vercel 把 query 已经帮你 urldecode 了
    const { msg_signature, timestamp, nonce, echostr } = query;

    console.log("Incoming:", { method, url, query });

    // ---------- 6.1 URL 验证（保存配置时的 GET） ------------------
    if (method === "GET") {
      if (!echostr) {
        // 浏览器手动打开时直接给个 ok
        res.statusCode = 200;
        res.end("ok");
        return;
      }

      if (!msg_signature || !timestamp || !nonce) {
        console.error("GET missing signature params");
        res.statusCode = 200;
        res.end(echostr);
        return;
      }

      const sigOk = verifySignature(TOKEN, timestamp, nonce, echostr, msg_signature);
      if (!sigOk) {
        console.error("GET verify signature failed");
        // 官方建议：仍然 200 返回原串
        res.statusCode = 200;
        res.end(echostr);
        return;
      }

      try {
        const { msg } = decryptWeCom(echostr);
        console.log("GET decrypt echostr success, msg:", msg);
        res.statusCode = 200;
        res.end(msg); // 明文直接回
      } catch (e) {
        console.error("GET decrypt echostr error:", e);
        res.statusCode = 200;
        res.end(echostr);
      }
      return;
    }

    // ---------- 6.2 接收消息 + 被动回复（POST） --------------------
    if (method === "POST") {
      let bodyStr = "";
      req.on("data", (chunk) => (bodyStr += chunk));
      req.on("end", () => {
        try {
          console.log("raw body:", bodyStr);

          // 1) 提取 encrypt
          let encrypt;
          try {
            const json = JSON.parse(bodyStr || "{}");
            encrypt = json.encrypt;
          } catch (e) {
            console.error("POST JSON parse error:", e);
            res.statusCode = 200;
            res.end("invalid json");
            return;
          }

          if (!encrypt) {
            console.error("POST missing encrypt");
            res.statusCode = 200;
            res.end("missing encrypt");
            return;
          }

          if (!msg_signature || !timestamp || !nonce) {
            console.error("POST missing signature params");
            res.statusCode = 200;
            res.end("missing signature");
            return;
          }

          // 2) 校验签名
          const sigOk = verifySignature(
            TOKEN,
            timestamp,
            nonce,
            encrypt,
            msg_signature
          );
          if (!sigOk) {
            console.error("POST verify signature failed");
            res.statusCode = 200;
            res.end("sig error");
            return;
          }

          // 3) 解密得到明文 JSON
          let plainMsg;
          try {
            const { msg } = decryptWeCom(encrypt);
            plainMsg = msg;
            console.log("decrypt success, plain msg:", plainMsg);
          } catch (e) {
            console.error("decrypt error:", e);
            res.statusCode = 200;
            res.end("decrypt error");
            return;
          }

          let eventObj = {};
          try {
            eventObj = JSON.parse(plainMsg);
          } catch (e) {
            console.error("plain msg is not valid JSON:", e);
          }

          // 4) 构造明文回复 —— 带上一些源字段，更接近“官方协议”
          let userText = "";
          if (
            eventObj.msgtype === "text" &&
            eventObj.text &&
            typeof eventObj.text.content === "string"
          ) {
            userText = eventObj.text.content;
          }

          const replyPlainObj = {
            // 这几项是从原消息抄过来的，防止协议要求
            aibotid: eventObj.aibotid,
            chattype: eventObj.chattype,
            from: eventObj.from,
            // 下发内容
            msgtype: "text",
            text: {
              content: `你刚刚说：${userText || "(空内容)"}`,
            },
          };

          const replyPlainStr = JSON.stringify(replyPlainObj);
          console.log("reply plain:", replyPlainStr);

          // 5) 加密回复
          const replyPacket = encryptWeCom(replyPlainStr, nonce);
          console.log("replyPacket:", replyPacket);

          // 5.1 自检：用 decryptWeCom 再解一遍，确认能还原
          try {
            const selfCheck = decryptWeCom(replyPacket.encrypt);
            console.log("selfCheck decrypt of reply:", selfCheck);
          } catch (e) {
            console.error("selfCheck decrypt reply error:", e);
          }

          // 6) 返回给企业微信
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.statusCode = 200;
          res.end(JSON.stringify(replyPacket));
        } catch (e) {
          console.error("POST handler error:", e);
          // 官方建议：出错也尽量 200，避免重试
          res.statusCode = 200;
          res.end("");
        }
      });
      return;
    }

    // 其它方法直接 405
    res.statusCode = 405;
    res.end("Only GET/POST allowed");
  } catch (e) {
    console.error("handler fatal error:", e);
    res.statusCode = 500;
    res.end("internal error");
  }
};
