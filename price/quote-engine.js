// price/quote-engine.js
const { loadSheets } = require("./data-loader");

// ---------- 配置（对应你 YAML 的 settings/pricing 等） ----------

const SETTINGS = {
  parseError: "型号解析失败：需列键.行键（以“.”分隔）。",
  notFound: ({ columnKey, rowKey }) =>
    `未定位到（列:${columnKey} × 行:${rowKey}）。`,
  emptyCell: ({ sheet, column, row }) =>
    `已命中表${sheet}，列:${column} × 行:${row} 为空。`,
  routingRules: [
    { prefix: "FFLM", sheets: ["FFLM"] },
    { prefix: "MUMP", sheets: ["MUMP"] },
    { prefix: "VF", sheets: ["VF-1", "VFX-1", "VF-VFX-2"] },
    { prefix: "VMF", sheets: ["VMP-VMPX-1", "VMP-VMPX-2"] },
    { prefix: "VMP", sheets: ["VMP-VMPX-1", "VMP-VMPX-2"] },
    { prefix: "VM", sheets: ["VMP-VMPX-1", "VMP-VMPX-2"] },
    { prefix: "FF", sheets: ["FF"] },
    { prefix: "M", sheets: ["M-MLF"] }
  ],
  defaultSheets: [
    "VF-1",
    "VFX-1",
    "VF-VFX-2",
    "VMP-VMPX-1",
    "VMP-VMPX-2",
    "M-MLF",
    "FFLM",
    "FF",
    "MUMP"
  ],
  pricing: {
    suffixEndings: [
      "03LFK",
      "03LF",
      "03SFLFK",
      "03SFLF",
      "04HTECKLF",
      "04HTECLF",
      "07LF",
      "07LFK"
    ],
    mHeadWhitelist: ["M010", "M015", "M020", "M025", "M032", "M040"],
    roundingDigitsEur: 2,
    salesMultiplierToCny: 12.5,
    roundingDigitsCny: 2
  }
};

// ---------- 工具函数：规范化、四舍五入、简单 sprintf ----------

function toHalfWidth(str) {
  if (!str) return "";
  let s = String(str);
  // 替换常见中文符号
  s = s
    .replace(/，/g, ",")
    .replace(/[。．・]/g, ".")
    .replace(/　/g, " ");
  // 全角转半角
  let r = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) {
      r += String.fromCharCode(code - 0xfee0);
    } else if (code === 0x3000) {
      r += " ";
    } else {
      r += ch;
    }
  }
  return r.trim();
}

function normalize(str) {
  return toHalfWidth(str).toUpperCase();
}

function roundTo(num, digits) {
  const factor = Math.pow(10, digits);
  return Math.round(num * factor) / factor;
}

function sprintf(fmt, ...args) {
  let i = 0;
  return fmt.replace(/%(\.\d+)?f/g, m => {
    const v = Number(args[i++] ?? 0);
    const digits =
      m === "%f" ? 2 : Number(m.slice(2, -1)); // %.2f -> 2
    return v.toFixed(digits);
  });
}

// ---------- 1. 型号解析（严格按照 YAML 的分段规则） ----------

function parseModel(modelRaw) {
  const cleaned = toHalfWidth(modelRaw);
  if (!cleaned) throw new Error(SETTINGS.parseError);

  const parts = cleaned
    .split(/[.．・]/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  if (parts.length < 2) {
    throw new Error(SETTINGS.parseError);
  }

  let columnKey;
  let rowKey;

  if (parts.length === 2) {
    columnKey = parts[0];
    rowKey = parts[1];
  } else if (parts.length === 3) {
    columnKey = `${parts[0]}.${parts[1]}`;
    rowKey = parts[2];
  } else if (parts.length === 4) {
    columnKey = `${parts[0]}.${parts[1]}`;
    rowKey = `${parts[2]}.${parts[3]}`;
  } else {
    const colParts = parts.slice(0, parts.length - 2);
    columnKey = colParts.join(".");
    rowKey = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  }

  return { columnKey, rowKey };
}

// ---------- 2. 路由到目标 sheet ----------

function routeSheets(modelRaw) {
  const normalizedModel = normalize(modelRaw);
  for (const rule of SETTINGS.routingRules) {
    if (normalizedModel.startsWith(rule.prefix)) {
      return rule.sheets;
    }
  }
  return SETTINGS.defaultSheets;
}

// ---------- 3. 在指定 sheet 中做“严格匹配”查价 ----------

function locatePrice(columnKey, rowKey, sheetNames) {
  const sheets = loadSheets();
  const colKeyNorm = normalize(columnKey);
  const rowKeyNorm = normalize(rowKey);

  for (const sheetName of sheetNames) {
    const sheet = sheets[sheetName];
    if (!sheet) continue;

    const { header, rows } = sheet;

    // 找列
    let colIndex = -1;
    for (let i = 0; i < header.length; i++) {
      const h = header[i];
      if (normalize(h) === colKeyNorm) {
        colIndex = i;
        break;
      }
    }
    if (colIndex === -1) {
      continue;
    }

    // 找行（首列）
    let rowIndex = -1;
    for (let r = 0; r < rows.length; r++) {
      const firstCell = rows[r][0];
      if (normalize(firstCell) === rowKeyNorm) {
        rowIndex = r;
        break;
      }
    }
    if (rowIndex === -1) {
      continue;
    }

    const value = rows[rowIndex][colIndex];

    if (
      value === undefined ||
      value === null ||
      String(value).trim() === ""
    ) {
      throw new Error(
        SETTINGS.emptyCell({
          sheet: sheetName,
          column: columnKey,
          row: rowKey
        })
      );
    }

    return {
      sheet: sheetName,
      column: columnKey,
      row: rowKey,
      price: Number(value)
    };
  }

  throw new Error(
    SETTINGS.notFound({
      columnKey,
      rowKey
    })
  );
}

// ---------- 4. 调整价格规则 ----------

function adjustPrice(modelRaw, basePriceEurRaw) {
  const base = Number(basePriceEurRaw);
  if (Number.isNaN(base)) {
    throw new Error("价格表中的单元格不是有效数字。");
  }

  const normModel = normalize(modelRaw);
  const parts = normModel.split(".");
  const headToken = parts[0] || ""; // 如 VMP010 / VMPX010 / M025 / VF040

  const isVFX = headToken.startsWith("VFX");
  const isVMPX = headToken.startsWith("VMPX");

  const suffixEndings = SETTINGS.pricing.suffixEndings.map(s =>
    s.toUpperCase()
  );
  const mWhitelist = SETTINGS.pricing.mHeadWhitelist;

  const hitSuffix = suffixEndings.some(sfx =>
    normModel.endsWith(sfx)
  );
  const mWhitelistHit = mWhitelist.includes(headToken);

  let adjusted = base;
  let rule = "NONE";

  if (isVFX) {
    adjusted = base * 1.4;
    rule = "VFX_PREFIX";
  } else if (isVMPX) {
    adjusted = base * 1.5 + 55;
    rule = "VMPX_PREFIX";
  } else if (hitSuffix && mWhitelistHit) {
    adjusted = base * 1.8 + 35;
    rule = "SUFFIX_SET_A";
  } else if (hitSuffix) {
    adjusted = base * 1.8;
    rule = "SUFFIX_SET_B";
  }

  const baseRounded = roundTo(base, SETTINGS.pricing.roundingDigitsEur);
  const adjRounded = roundTo(adjusted, SETTINGS.pricing.roundingDigitsEur);

  return {
    baseEur: baseRounded,
    adjustedEur: adjRounded,
    rule
  };
}

// ---------- 5. 拼出最终输出（包含公式 + 销售价） ----------

function finalizeOutput(info, pricing) {
  const baseStr = sprintf("%.2f", pricing.baseEur);
  const adjStr = sprintf("%.2f", pricing.adjustedEur);

  let formula;
  switch (pricing.rule) {
    case "VFX_PREFIX":
      formula = sprintf("(%s × 1.4) = %s", pricing.baseEur, pricing.adjustedEur);
      break;
    case "VMPX_PREFIX":
      formula = sprintf(
        "(%s × 1.5) + 55 = %s",
        pricing.baseEur,
        pricing.adjustedEur
      );
      break;
    case "SUFFIX_SET_A":
      formula = sprintf(
        "(%s × 1.8) + 35 = %s",
        pricing.baseEur,
        pricing.adjustedEur
      );
      break;
    case "SUFFIX_SET_B":
      formula = sprintf(
        "(%s × 1.8) = %s",
        pricing.baseEur,
        pricing.adjustedEur
      );
      break;
    default:
      formula = sprintf("(%s) = %s", pricing.baseEur, pricing.adjustedEur);
      break;
  }

  const salesMul = SETTINGS.pricing.salesMultiplierToCny;
  const salesRaw = pricing.adjustedEur * salesMul;
  const salesRounded = roundTo(
    salesRaw,
    SETTINGS.pricing.roundingDigitsCny
  );
  const salesStr = sprintf("%.2f", salesRounded);

  const text =
    `表：${info.sheet}\n` +
    `定位：${info.column} × ${info.row}\n` +
    `原值(EUR)：${baseStr}\n` +
    `规则：${pricing.rule}\n` +
    `计算公式：${formula}\n` +
    `调整后(EUR)：${adjStr}\n` +
    `销售价格系数：${salesMul}\n` +
    `销售价格(CNY)：${salesStr}`;

  return {
    sheet: info.sheet,
    column: info.column,
    row: info.row,
    base_price_eur: baseStr,
    adjusted_price_eur: adjStr,
    rule_applied: pricing.rule,
    rule_formula: formula,
    sales_multiplier: salesMul,
    sales_price_cny: salesStr,
    text
  };
}

// ---------- 对外主函数：quote(model) ----------

function quote(model) {
  try {
    const { columnKey, rowKey } = parseModel(model);
    const sheets = routeSheets(model);
    const info = locatePrice(columnKey, rowKey, sheets);
    const pricing = adjustPrice(model, info.price);
    const result = finalizeOutput(info, pricing);

    return {
      ok: true,
      ...result
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err)
    };
  }
}

module.exports = {
  quote
};
