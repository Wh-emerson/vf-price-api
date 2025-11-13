// price/data-loader.js
const path = require("path");
const XLSX = require("xlsx");

// Excel 文件路径：放在项目根目录
const WORKBOOK_PATH = path.join(__dirname, "..", "VF系列价格表.xlsx");

// 缓存
let workbookCache = null;
let sheetsCache = null;

// 只读一次工作簿
function loadWorkbookOnce() {
  if (workbookCache) return workbookCache;
  workbookCache = XLSX.readFile(WORKBOOK_PATH);
  return workbookCache;
}

// 返回：{ [sheetName]: { header: string[], rows: any[][] } }
function loadSheets() {
  if (sheetsCache) return sheetsCache;

  const wb = loadWorkbookOnce();
  const targetSheets = [
    "VF-1",
    "VFX-1",
    "VF-VFX-2",
    "VMP-VMPX-1",
    "VMP-VMPX-2",
    "M-MLF",
    "FFLM",
    "FF",
    "MUMP"
  ];

  const map = {};

  for (const name of targetSheets) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    if (!aoa.length) continue;

    const header = aoa[0].map(v =>
      v === undefined || v === null ? "" : String(v)
    );
    const rows = aoa.slice(1);
    map[name] = { header, rows };
  }

  sheetsCache = map;
  return map;
}

module.exports = {
  loadSheets
};
