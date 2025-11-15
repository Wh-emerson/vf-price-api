// api/quote.js
// 企业微信「内部智能机器人 · API 模式」回调（对齐官方 Python3 JSON Demo）
// 功能：
// 1）GET：URL 校验（解密 echostr 返回明文）
// 2）POST：解密用户消息 → 调用业务逻辑 → 按 msgtype=stream 格式加密返回
//
// 全程只用 Token + EncodingAESKey，不需要 corpsecret / send_url / access_token。

const crypto = require("crypto");

// ===== 1. 机器人回调配置（用你的实际配置替换） =====
const TOKEN = "h5PEfU4TSE4I7mxLlDyFe9HrfwKp"; // TODO: 替换为企微机器人配置页里的 Token
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj"; // TODO: 替换为 43 位 EncodingAESKey
// 智能机器人场景 receiveid 为空字符串（官方文档说明）
const RECEIVE_ID = "";

// ===== 2. 签名计算 / 校验 =====
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

// ===== 4. AES key / 解密 =====
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
  const rest = decrypted.slice(20 + msgLen).toString("utf8"); // receiveId（这里为空）

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

// ===== 6. 业务逻辑入口：在这里塞“生意逻辑和脑子” =====
// eventObj: 企微解密后的完整 JSON
// userText: 用户发来的文本内容（string）
async function runBusinessLogic(eventObj, userText) {
  // 1）空消息兜底
  if (!userText || !userText.trim()) {
    return "请发送要查询的型号或问题，例如：VF040.02X.33.30LA 或 “帮我查价 VF040.02X.33.30LA”。";
  }

  const text = userText.trim();

  // 2）简单指令示例：输入 “帮助”
  if (text === "帮助" || text.toLowerCase() === "help") {
    return [
      "👋 我是 VF/VMP 报价助手（测试版）。你可以这样用我：",
      "",
      "1）直接发型号：",
      "   例如：VF040.02X.33.30LA",
      "",
      "2）带说明的指令：",
      "   例如：查价 VMP010.03XKSF.71",
      "",
      "3）若我看不懂，就会原样重复你的内容，方便你检查格式。",
    ].join("\n");
  }

  // 3）简单型号识别示例（你可以以后改成更严谨的正则）
  //   检测是否疑似减速机型号，后续在这里调用你的查价引擎 / API
  const modelPattern = /\b(VF|VFX|VMP|VMPX|M|FV|WM)[A-Za-z0-9\.\-]*/;
  const modelMatch = text.match(modelPattern);

  if (modelMatch) {
    const model = modelMatch[0];

    // ===== TODO：在这里调用你的实际查价逻辑 =====
    // 例：调用你未来的 Vercel / Railway / 本地报价 API
    //
    // const resp = await fetch("https://你的报价API地址/quote", {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify({ model }),
    // });
    // const data = await resp.json();
    //
    // 然后组织成返回文案：
    // return `型号：${model}\n欧元价：${data.eur} EUR\n人民币售价：${data.cny} CNY`;

    // 这里先给你一个占位实现，等你把报价 API 搭好再替换：
    return [
      `检测到型号：${model}`,
      "",
      "此处应该调用你的报价引擎（Excel / Python / API），",
      "返回：基础价、折扣后售价、人民币售价等明细。",
      "",
      "目前还是占位实现，你可以在 quote.js 的 runBusinessLogic 里，",
      "把“占位实现”这一段换成真实查价调用。",
    ].join("\n");
  }

  // 4）默认兜底：当普通聊天问问题时，可以接 GPT / FAQ / 自定义逻辑
  // 现在先简单回声，后续你可以在这里接你自己的 GPT API。
  return `你刚刚说：${text}\n\n（目前是测试版：未匹配到型号指令，就先原样复读。）`;
}

// ===== 7. Vercel Handler =====
module.exports = async function handler(req, res) {
  try {
    const { method, url, query = {} } = req;
    const { msg_signature, timestamp, nonce, echostr } = query;

    console.log("Incoming:", { method, url, query });

    // ---------- 7.1 URL 验证（GET） ----------
    if (method === "GET") {
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
        res.status(200).send(echostr);
        return;
      }

      try {
        const { msg } = decryptWeCom(echostr);
        console.log("GET decrypt echostr success, msg:", msg);
        res.status(200).send(msg);
      } catch (e) {
        console.error("GET decrypt echostr error:", e);
        res.status(200).send(echostr);
      }
      return;
    }

    // ---------- 7.2 接收消息（POST） ----------
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

            // 解密 encrypt 得到明文 JSON 字符串
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

            // 解析明文 JSON（用户消息）
            let eventObj = {};
            try {
              eventObj = JSON.parse(plainMsg);
            } catch (e) {
              console.error("plain msg is not valid JSON:", e);
              eventObj = {};
            }

            // 提取用户文本
            let userText = "";
            if (
              eventObj.msgtype === "text" &&
              eventObj.text &&
              typeof eventObj.text.content === "string"
            ) {
              userText = eventObj.text.content;
            }

            // ===== 核心：调用你的业务逻辑“大脑” =====
            const replyContent = await runBusinessLogic(eventObj, userText);

            // 构造 stream 明文回复（对齐官方 Demo）
            const streamId =
              eventObj.msgid ||
              (crypto.randomUUID
                ? crypto.randomUUID()
                : crypto.randomBytes(8).toString("hex"));
            const finish = true;

            const replyPlainObj = {
              msgtype: "stream",
              stream: {
                id: streamId,
                finish,
                content: replyContent,
              },
            };

            const replyPlainStr = JSON.stringify(replyPlainObj);
            console.log("reply plain (stream):", replyPlainStr);

            // 加密回复
            const replyPacket = encryptWeCom(replyPlainStr, nonce);
            console.log("replyPacket:", replyPacket);

            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.status(200).send(JSON.stringify(replyPacket));
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
