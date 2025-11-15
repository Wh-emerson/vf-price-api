// api/quote.js
const crypto = require("crypto");
const WXBizMsgCrypt = require("wechat-crypto");

// TODO: 这三个一定要和企业微信「回调配置」里的一模一样
const TOKEN = "h5PEfU4TSE4I7mxLlDyFe9HrfwKp";
const EncodingAESKey = "3Lw2u97MzINbC0rNwfdHJtjuVzIJj4q1Ol5Pu397Pnj"; // 不要少字符
// 智能机器人场景，官方文档明确：ReceiveId 为空字符串 ""
const RECEIVE_ID = "";

const cryptor = new WXBizMsgCrypt(TOKEN, AES_KEY, CORP_ID);

module.exports = async function handler(req, res) {
  const { method, url, query } = req;

  // -------------------------
  // 1. GET：用于企业微信“URL校验”
  // -------------------------
  if (method === "GET") {
    const { msg_signature, timestamp, nonce, echostr } = query;

    if (!echostr) {
      // 没带 echostr，多半是你自己在浏览器点的
      res.status(200).send("ok");
      return;
    }

    // 按企微规范验签 + 解密 echostr
    const sig2 = cryptor.getSignature(timestamp, nonce, echostr);
    if (sig2 !== msg_signature) {
      console.error("GET check signature mismatch", { msg_signature, sig2 });
      res.status(401).send("invalid signature");
      return;
    }

    const decrypted = cryptor.decrypt(echostr);
    // 企微要求：原样返回解密后的明文
    res.status(200).send(decrypted.message);
    return;
  }

  // 只允许 POST 走到下面
  if (method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const { msg_signature, timestamp, nonce } = query;

  // -------------------------
  // 2. 读取原始 body（加密的 JSON）
  // -------------------------
  let raw = "";
  await new Promise((resolve, reject) => {
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", resolve);
    req.on("error", reject);
  });

  console.log("Incoming:", { method, url, query });
  console.log("raw body:", raw);

  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    console.error("invalid json body", e);
    res.status(400).send("invalid json");
    return;
  }

  const { encrypt } = body || {};
  if (!encrypt) {
    res.status(400).send("missing encrypt");
    return;
  }

  // -------------------------
  // 3. 验签 + 解密
  // -------------------------
  const sig2 = cryptor.getSignature(timestamp, nonce, encrypt);
  if (sig2 !== msg_signature) {
    console.error("POST signature mismatch", { msg_signature, sig2 });
    res.status(401).send("invalid signature");
    return;
  }

  const decrypted = cryptor.decrypt(encrypt); // {message, id}
  let msg;
  try {
    msg = JSON.parse(decrypted.message);
  } catch (e) {
    console.error("decrypt json parse error", e, decrypted.message);
    res.status(400).send("decrypt json error");
    return;
  }

  console.log("decrypt success, plain msg:", msg);

  // -------------------------
  // 4. 业务逻辑：根据 msg 生成“明文回复”
  //    ——以后你的查价逻辑就写在这里
  // -------------------------
  let replyText = "收到你的消息";

  if (msg.msgtype === "text" && msg.text && msg.text.content) {
    // 这里先做个“复读机”，确认加解密链路没问题
    replyText = `你刚刚说：${msg.text.content}`;
  }

  const replyPlain = {
    msgtype: "text",
    text: { content: replyText },
  };

  console.log("reply plain:", replyPlain);

  // -------------------------
  // 5. 按 101033 文档要求，把回复加密并返回
  // -------------------------
  const replyStr = JSON.stringify(replyPlain);
  const encryptReply = cryptor.encrypt(replyStr);

  // 可以重用原 timestamp/nonce，也可以新生成；这里生成新的
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonceReply = crypto.randomBytes(8).toString("hex");

  const msgSignatureReply = cryptor.getSignature(
    ts,
    nonceReply,
    encryptReply
  );

  // 返回给企业微信的就是这一包
  res.json({
    msg_signature: msgSignatureReply,
    timestamp: ts,
    nonce: nonceReply,
    encrypt: encryptReply,
  });
};
