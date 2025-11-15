// api/quote.js
// 企业微信「内部智能机器人 · API 模式」回调 + 主动发送回复
// 1）用 crypto 自己实现回调加解密（按 101031 / 加解密方案）
// 2）用 101033 的“机器人发送消息 API”主动把回复发回给用户

const crypto = require("crypto");

// ===== 1. 机器人回调配置 =====
// 这两项必须和企业微信后台机器人配置页完全一致
const TOKEN = "h5PEfU4TSE4I7mxLlDyFe9HrfwKp";
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj"; // 一定是 43 位
// 智能机器人场景 receiveid 为空字符串（官方说明）
const RECEIVE_ID = "";

// ===== 2. 企业微信「发送消息」所需配置 =====
// 建议在 Vercel 的 Environment Variables 里配置：WX_CORP_ID / WX_CORP_SECRET / WX_SEND_URL
// 其中：
//   WX_CORP_ID      = 企业 ID（管理后台可以看到）
//   WX_CORP_SECRET  = 智能机器人对应的 Secret（或你为这个机器人开通的那一项）
//   WX_SEND_URL     = 101033 文档中【机器人发送消息接口】的完整 URL（不含 access_token 参数）
//                    例如类似： https://qyapi.weixin.qq.com/cgi-bin/aibot/response
const WX_CORP_ID = process.env.WX_CORP_ID || "";
const WX_CORP_SECRET = process.env.WX_CORP_SECRET || "";
const WX_SEND_URL = process.env.WX_SEND_URL || "";

// ===== 3. 签名计算 / 校验 =====
function calcSignature(token, timestamp, nonce, encrypt) {
  const arr = [token, timestamp, nonce, encrypt].sort();
  return crypto.createHash("sha1").update(arr.join("")).digest("hex");
}

function verifySignature(token, timestamp, nonce, encrypt, msgSignature) {
  const sig = calcSignature(token, timestamp, nonce, encrypt);
  return sig === msgSignature;
}

// ===== 4. PKCS#7 补位 / 去补位 =====
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

// ===== 5. AES key / 解密 encrypt/echostr =====
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

// ===== 6. access_token 获取 & 缓存 =====
// 标准企业微信 gettoken 接口
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  if (!WX_CORP_ID || !WX_CORP_SECRET) {
    throw new Error("WX_CORP_ID / WX_CORP_SECRET 未配置");
  }

  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const url =
    "https://qyapi.weixin.qq.com/cgi-bin/gettoken" +
    `?corpid=${encodeURIComponent(WX_CORP_ID)}` +
    `&corpsecret=${encodeURIComponent(WX_CORP_SECRET)}`;

  const resp = await fetch(url);
  const data = await resp.json();
  console.log("gettoken result:", data);

  if (data.errcode !== 0) {
    throw new Error("gettoken failed: " + JSON.stringify(data));
  }

  cachedToken = data.access_token;
  // 提前 60 秒过期
  cachedTokenExpiresAt = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// ===== 7. 调用 101033 的「机器人发送消息接口」 =====
async function sendRobotText(eventObj, replyText) {
  if (!WX_SEND_URL) {
    throw new Error("WX_SEND_URL 未配置（请填 101033 文档中的发送接口 URL）");
  }

  const token = await getAccessToken();
  const url = `${WX_SEND_URL}?access_token=${encodeURIComponent(token)}`;

  // ⚠️ payload 结构请以 101033 文档为准，这里是一个“最合理的猜测模板”
  // 通常会包含：aibotid、发送对象、消息类型、内容等字段
  const payload = {
    aibotid: eventObj.aibotid,          // 回调里带回来的机器人 ID
    // 下面这几个字段名，你需要对照 101033 文档调整：
    // 有可能是 touser / open_userid / chatid 等，这里先按最直接的写法占位
    touser: eventObj.from && eventObj.from.userid,
    chattype: eventObj.chattype,        // "single" / "group"
    msgtype: "text",
    text: {
      content: replyText,
    },
  };

  console.log("sendRobotText payload:", payload);

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const data = await resp.json();
  console.log("sendRobotText result:", data);
  return data;
}

// ===== 8. Vercel Handler =====
module.exports = async function handler(req, res) {
  try {
    const { method, url, query = {} } = req;
    const { msg_signature, timestamp, nonce, echostr } = query;

    console.log("Incoming:", { method, url, query });

    // ---------- 8.1 URL 验证（GET） ----------
    if (method === "GET") {
      if (!echostr) {
        // 你自己在浏览器打开 /api/quote?xxx 的情况
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

    // ---------- 8.2 接收消息（POST） ----------
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

            // 3）解析事件 JSON
            let eventObj = {};
            try {
              eventObj = JSON.parse(plainMsg);
            } catch (e) {
              console.error("plain msg is not valid JSON:", e);
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

            const replyText = `你刚刚说：${userText || "(空内容)"}`;
            console.log("replyText:", replyText);

            // 5）调用 101033 的发送接口，主动把这条消息发回去
            try {
              const sendResult = await sendRobotText(eventObj, replyText);
              console.log("sendRobotText result (final):", sendResult);
            } catch (e) {
              console.error("sendRobotText error:", e);
              // 这里即使失败，也不要让企微重试回调，所以仍然返回 200
            }

            // 6）对回调本身，只返回一个简单 200 即可
            res.status(200).send("ok");
          } catch (e) {
            console.error("POST handler error:", e);
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
