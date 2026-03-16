/******************************************************************
 * 1) CONFIG
 ******************************************************************/
// ⚠️ TEST ONLY: Nhập key tạm thời trong UI, không hard-code.
const OPENAI_API_KEY = "";

// Model hỗ trợ vision + structured outputs (ví dụ trong docs dùng gpt-4.1-mini) :contentReference[oaicite:0]{index=0}
const MODEL = "gpt-4.1-mini";

// Endpoint Responses API :contentReference[oaicite:1]{index=1}
const ENDPOINT = "https://api.openai.com/v1/responses";
// Pricing per 1M tokens for gpt-4.1-mini (text/cached/output).
const MODEL_PRICING = {
  "gpt-4.1-mini": {
    inputUsdPer1M: 0.40,
    cachedInputUsdPer1M: 0.10,
    outputUsdPer1M: 1.60
  }
};

/******************************************************************
 * 2) UI helpers
 ******************************************************************/
const $ = (id) => document.getElementById(id);
const els = {
  file: $("file"),
  cameraFile: $("cameraFile"),
  btnCamera: $("btnCamera"),
  apiKey: $("apiKey"),
  usdToVnd: $("usdToVnd"),
  btnScan: $("btnScan"),
  btnToggleCylinder: $("btnToggleCylinder"),
  btnClear: $("btnClear"),
  btnCopyClipboard: $("btnCopyClipboard"),
  status: $("status"),
  preview: $("preview"),
  clipboardText: $("clipboardText"),
  debug: $("debug"),
  costUsd: $("costUsd"),
  costVnd: $("costVnd"),
  tokenInfo: $("tokenInfo"),
  fields: {
    R: { sphere: $("R_sphere"), cyl: $("R_cyl"), axis: $("R_axis"), pd: $("R_pd"), add: $("R_add") },
    L: { sphere: $("L_sphere"), cyl: $("L_cyl"), axis: $("L_axis"), pd: $("L_pd"), add: $("L_add") },
  }
};
const selectedFiles = [];

function refreshSelectionStatus() {
  if (!selectedFiles.length) {
    setStatus("Chưa có ảnh.");
    els.preview.removeAttribute("src");
    return;
  }

  const lastFile = selectedFiles[selectedFiles.length - 1];
  fileToDataURL(lastFile).then((url) => {
    els.preview.src = url;
  }).catch(() => {});
  setStatus(`Đã có ${selectedFiles.length} ảnh. Bấm Scan & Fill.`);
}

function addFilesToSelection(incomingFiles) {
  const room = 2 - selectedFiles.length;
  if (room <= 0) {
    alert("Đã đủ 2 ảnh. Anh bấm Clear nếu muốn chụp/chọn lại.");
    return;
  }
  const accepted = incomingFiles.slice(0, room);
  selectedFiles.push(...accepted);
  if (incomingFiles.length > accepted.length) {
    alert("App chỉ giữ tối đa 2 ảnh/lần scan.");
  }
  refreshSelectionStatus();
}

function setStatus(msg) { els.status.textContent = msg; }
function setBusy(isBusy) {
  els.btnScan.disabled = isBusy;
  els.file.disabled = isBusy;
  els.cameraFile.disabled = isBusy;
  els.btnCamera.disabled = isBusy;
  els.btnClear.disabled = isBusy;
  els.btnToggleCylinder.disabled = isBusy;
  els.btnCopyClipboard.disabled = isBusy;
}

function clearAll() {
  selectedFiles.length = 0;
  els.file.value = "";
  els.cameraFile.value = "";
  els.preview.removeAttribute("src");
  els.clipboardText.value = "";
  els.debug.textContent = "(trống)";
  els.costUsd.textContent = "USD: -";
  els.costVnd.textContent = "VND: -";
  els.tokenInfo.textContent = "(chưa có dữ liệu)";
  for (const side of ["R","L"]) {
    for (const k of ["sphere","cyl","axis","pd","add"]) els.fields[side][k].value = "";
  }
  setStatus("Đã clear.");
}

function fillFromResult(result) {
  // result = { right:{...}, left:{...}, notes, confidence }
  const norm = (v) => (v === null || v === undefined) ? "" : String(v);

  if (result?.right) {
    els.fields.R.sphere.value = norm(result.right.sphere);
    els.fields.R.cyl.value    = norm(result.right.cylinder);
    els.fields.R.axis.value   = norm(result.right.axis);
    els.fields.R.pd.value     = norm(result.right.pd);
    els.fields.R.add.value    = norm(result.right.add);
  }
  if (result?.left) {
    els.fields.L.sphere.value = norm(result.left.sphere);
    els.fields.L.cyl.value    = norm(result.left.cylinder);
    els.fields.L.axis.value   = norm(result.left.axis);
    els.fields.L.pd.value     = norm(result.left.pd);
    els.fields.L.add.value    = norm(result.left.add);
  }
}

function toCommaDecimal(v) {
  const s = asText(v);
  if (!s) return "";
  return s.replace(/\./g, ",");
}

function buildClipboardPrescriptionText(result) {
  const rSphere = toCommaDecimal(result?.right?.sphere);
  const rCyl = toCommaDecimal(result?.right?.cylinder);
  const rAxis = asText(result?.right?.axis);
  const lSphere = toCommaDecimal(result?.left?.sphere);
  const lCyl = toCommaDecimal(result?.left?.cylinder);
  const lAxis = asText(result?.left?.axis);

  return [
    "PRESCRIPTION",
    `R ${rSphere} ${rCyl} ${rAxis}`.trim(),
    `L ${lSphere} ${lCyl} ${lAxis}`.trim(),
    "TEXT COPIED TO CLIPBOARD",
    `${rSphere} ${rCyl}`.trim(),
    `${lSphere} ${lCyl}`.trim()
  ].join("\n");
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "absolute";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("Không copy được clipboard.");
}

const RX_FIELDS = ["sphere", "cylinder", "axis", "pd", "add"];

function asText(v) {
  return (v === null || v === undefined) ? "" : String(v).trim();
}

function isZeroLike(v) {
  const s = asText(v).replace(",", ".");
  if (!s) return false;
  return /^[-+]?0+(?:\.0+)?$/.test(s);
}

function sideStats(sideObj) {
  let nonZeroCount = 0;
  let zeroCount = 0;
  for (const field of RX_FIELDS) {
    const value = asText(sideObj?.[field]);
    if (!value) continue;
    if (isZeroLike(value)) zeroCount++;
    else nonZeroCount++;
  }
  return {
    nonZeroCount,
    isAllZeroPlaceholder: zeroCount === RX_FIELDS.length
  };
}

function pickBestSide(parsedList, sideName) {
  const candidates = parsedList.map((parsed, index) => ({
    index,
    side: parsed?.[sideName] || null,
    stats: sideStats(parsed?.[sideName])
  }));

  const bestReal = candidates
    .filter((c) => c.side && !c.stats.isAllZeroPlaceholder)
    .sort((a, b) => b.stats.nonZeroCount - a.stats.nonZeroCount)[0];

  if (bestReal) return bestReal.side;
  return candidates.find((c) => c.side)?.side || null;
}

function mergeParsedResults(parsedList) {
  if (!Array.isArray(parsedList) || parsedList.length === 0) return null;
  if (parsedList.length === 1) return parsedList[0];

  const right = pickBestSide(parsedList, "right");
  const left = pickBestSide(parsedList, "left");

  const notes = parsedList
    .map((p, i) => ({ i, note: asText(p?.notes) }))
    .filter((x) => x.note)
    .map((x) => `img${x.i + 1}: ${x.note}`);

  const confidenceValues = parsedList
    .map((p) => Number(p?.confidence))
    .filter((n) => Number.isFinite(n));

  return {
    right,
    left,
    notes: notes.length ? notes.join(" | ") : "Merged from multiple images",
    confidence: confidenceValues.length
      ? Math.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length)
      : 0
  };
}

function parseUsdToVndRate(raw) {
  const cleanedDigits = String(raw || "").replace(/[^\d]/g, "");
  const rate = Number(cleanedDigits);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function parseRxNumber(raw) {
  const normalized = asText(raw).replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function formatRxSigned(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-8) return "0.00";
  const sign = value > 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(2)}`;
}

function normalizeAxisValue(value) {
  if (!Number.isFinite(value)) return null;
  let axis = value;
  while (axis <= 0) axis += 180;
  while (axis > 180) axis -= 180;
  return axis;
}

function rotateAxis90(value) {
  const axis = normalizeAxisValue(value);
  if (!Number.isFinite(axis)) return null;
  let rotated = axis + 90;
  if (rotated > 180) rotated -= 180;
  return rotated;
}

function transposeSideToOppositeCylinder(side) {
  const sphere = parseRxNumber(els.fields[side].sphere.value);
  const cyl = parseRxNumber(els.fields[side].cyl.value);
  if (sphere === null || cyl === null) {
    return { ok: false, error: `${side}: thiếu hoặc sai Sphere/Cylinder.` };
  }

  const axisRaw = asText(els.fields[side].axis.value);
  const axisValue = axisRaw ? parseRxNumber(axisRaw) : null;
  if (axisRaw && axisValue === null) {
    return { ok: false, error: `${side}: Axis không hợp lệ.` };
  }

  const newSphere = sphere + cyl;
  const newCylinder = -cyl;
  const newAxis = axisRaw ? rotateAxis90(axisValue) : null;

  els.fields[side].sphere.value = formatRxSigned(newSphere);
  els.fields[side].cyl.value = formatRxSigned(newCylinder);
  els.fields[side].axis.value = Number.isFinite(newAxis) ? String(Math.round(newAxis)) : "";

  return { ok: true };
}

function getResultFromFields() {
  return {
    right: {
      sphere: asText(els.fields.R.sphere.value) || null,
      cylinder: asText(els.fields.R.cyl.value) || null,
      axis: asText(els.fields.R.axis.value) || null
    },
    left: {
      sphere: asText(els.fields.L.sphere.value) || null,
      cylinder: asText(els.fields.L.cyl.value) || null,
      axis: asText(els.fields.L.axis.value) || null
    }
  };
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 6,
    maximumFractionDigits: 6
  }).format(value);
}

function formatVnd(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(value);
}

function extractUsage(json) {
  const usage = json?.usage || {};
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  const cachedInputTokens = Number(
    usage.input_tokens_details?.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0
  );
  const totalTokens = Number(usage.total_tokens ?? (inputTokens + outputTokens));
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    cachedInputTokens: Number.isFinite(cachedInputTokens) ? cachedInputTokens : 0,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0
  };
}

function estimateCallCost(usage, model, usdToVndRate) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["gpt-4.1-mini"];
  const uncachedInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const usd =
    (uncachedInputTokens / 1_000_000) * pricing.inputUsdPer1M +
    (usage.cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPer1M +
    (usage.outputTokens / 1_000_000) * pricing.outputUsdPer1M;
  return {
    usd,
    vnd: usd * usdToVndRate,
    uncachedInputTokens
  };
}

function renderCostSummary(usageList, usdToVndRate, model) {
  const lines = [`Model: ${model}`, `Ty gia: 1 USD = ${Math.round(usdToVndRate).toLocaleString("vi-VN")} VND`];
  let totalUsd = 0;
  let totalVnd = 0;

  usageList.forEach((usage, i) => {
    const estimate = estimateCallCost(usage, model, usdToVndRate);
    totalUsd += estimate.usd;
    totalVnd += estimate.vnd;
    lines.push(
      `Call ${i + 1}: in ${usage.inputTokens} (cached ${usage.cachedInputTokens}), out ${usage.outputTokens}, total ${usage.totalTokens}, cost ${formatUsd(estimate.usd)} (~${formatVnd(estimate.vnd)})`
    );
  });

  els.costUsd.textContent = `USD: ${formatUsd(totalUsd)}`;
  els.costVnd.textContent = `VND: ${formatVnd(totalVnd)}`;
  els.tokenInfo.textContent = lines.join("\n");
}

/******************************************************************
 * 3) Image → base64 dataURL
 ******************************************************************/
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/******************************************************************
 * 4) Call OpenAI Responses API (vision + structured JSON)
 ******************************************************************/
async function scanImageAndFill(dataUrl, apiKey) {
  // Image input format: {type:"input_image", image_url:"data:image/...;base64,..."} :contentReference[oaicite:2]{index=2}
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      right: {
        type: "object",
        additionalProperties: false,
        properties: {
          sphere:   { type: ["string","null"] },
          cylinder: { type: ["string","null"] },
          axis:     { type: ["string","null"] },
          pd:       { type: ["string","null"] },
          add:      { type: ["string","null"] }
        },
        required: ["sphere","cylinder","axis","pd","add"]
      },
      left: {
        type: "object",
        additionalProperties: false,
        properties: {
          sphere:   { type: ["string","null"] },
          cylinder: { type: ["string","null"] },
          axis:     { type: ["string","null"] },
          pd:       { type: ["string","null"] },
          add:      { type: ["string","null"] }
        },
        required: ["sphere","cylinder","axis","pd","add"]
      },
      notes: { type: ["string","null"] },
      confidence: { type: "integer", minimum: 0, maximum: 100 }
    },
    required: ["right","left","notes","confidence"]
  };

  const body = {
    model: MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
`Bạn là trợ lý đọc đơn kính (eyeglass prescription) từ ảnh.
Nhiệm vụ: trích xuất đúng 5 trường cho mỗi mắt: Sphere, Cylinder, Axis, PD, ADD.

Quy tắc:
- Giữ nguyên dấu +/-, dấu chấm thập phân như trên ảnh.
- Axis luôn là số 0-180 (nếu không có, trả null).
- Nếu PD chỉ có 1 số (binocular PD), hãy trả số đó vào cả right.pd và left.pd và ghi notes rằng "binocular PD".
- Nếu ảnh không có ADD (single vision), trả null cho add.
- Nếu không chắc 1 trường, trả null cho trường đó và ghi notes ngắn gọn.
Chỉ trả về JSON theo schema.`
          },
          {
            type: "input_image",
            image_url: dataUrl
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "rx_extract",
        strict: true,
        schema
      }
    }
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }

  const json = await res.json();

  // 1) Ưu tiên output_text nếu có (docs có helper output_text trong SDK; API thường trả field này) :contentReference[oaicite:3]{index=3}
  let raw = json.output_text;

  // 2) Fallback: tìm message->content->output_text
  if (!raw && Array.isArray(json.output)) {
    for (const item of json.output) {
      if (item.type === "message" && item.role === "assistant" && Array.isArray(item.content)) {
        const part = item.content.find(p => p.type === "output_text" || p.type === "text");
        if (part?.text) { raw = part.text; break; }
      }
    }
  }

  if (!raw) {
    // show full response for debugging
    els.debug.textContent = JSON.stringify(json, null, 2);
    throw new Error("Không tìm thấy output_text trong response (check debug).");
  }

  // raw có thể là JSON string
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // nếu model trả JSON nhưng có rác, thử trích đoạn {...}
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Output không parse được JSON. Check debug.");
    parsed = JSON.parse(m[0]);
  }

  return { parsed, raw, full: json, usage: extractUsage(json) };
}

/******************************************************************
 * 5) Wire up events
 ******************************************************************/
els.btnClear.addEventListener("click", clearAll);

els.file.addEventListener("change", () => {
  const files = Array.from(els.file.files || []);
  if (!files.length) return;
  addFilesToSelection(files);
  els.file.value = "";
});

els.btnCamera.addEventListener("click", () => {
  els.cameraFile.click();
});

els.btnToggleCylinder.addEventListener("click", () => {
  const right = transposeSideToOppositeCylinder("R");
  const left = transposeSideToOppositeCylinder("L");
  const errors = [right, left].filter((r) => !r.ok).map((r) => r.error);

  if (errors.length) {
    alert(`Không thể toggle cylinder:\n- ${errors.join("\n- ")}`);
    return;
  }

  const text = buildClipboardPrescriptionText(getResultFromFields());
  els.clipboardText.value = text;
  setStatus("Đã toggle giữa +Cyl / -Cyl cho cả 2 mắt.");
});

els.cameraFile.addEventListener("change", () => {
  const files = Array.from(els.cameraFile.files || []);
  if (!files.length) return;
  addFilesToSelection(files.slice(0, 1));
  els.cameraFile.value = "";
});

els.btnScan.addEventListener("click", async () => {
  try {
    const files = selectedFiles.slice();
    if (!files.length) {
      alert("Anh chọn/chụp ảnh trước đã.");
      return;
    }
    if (files.length > 2) {
      alert("Hiện app chỉ hỗ trợ tối đa 2 ảnh/lần scan.");
      return;
    }
    const apiKey = (els.apiKey.value || OPENAI_API_KEY || "").trim();
    if (!apiKey || !apiKey.startsWith("sk-")) {
      alert("Anh nhập OpenAI API key hợp lệ (bắt đầu bằng sk-) trước nhé.");
      return;
    }
    const usdToVndRate = parseUsdToVndRate(els.usdToVnd.value);
    if (!usdToVndRate) {
      alert("Anh nhập tỷ giá USD/VND hợp lệ trước nhé (ví dụ 26270).");
      return;
    }

    setBusy(true);
    setStatus(`Đang scan ${files.length} ảnh…`);
    els.debug.textContent = "(đang gọi API…)";
    els.tokenInfo.textContent = "(đang tính token/cost...)";

    const parsedList = [];
    const usageList = [];
    for (let i = 0; i < files.length; i++) {
      setStatus(`Đang scan ảnh ${i + 1}/${files.length}…`);
      const dataUrl = await fileToDataURL(files[i]);
      const { parsed, usage } = await scanImageAndFill(dataUrl, apiKey);
      parsedList.push(parsed);
      usageList.push(usage);
    }

    const merged = mergeParsedResults(parsedList);
    renderCostSummary(usageList, usdToVndRate, MODEL);
    els.debug.textContent = JSON.stringify({ perImage: parsedList, merged, usage: usageList }, null, 2);
    fillFromResult(merged);
    const clipboardText = buildClipboardPrescriptionText(merged);
    els.clipboardText.value = clipboardText;
    await copyTextToClipboard(clipboardText);
    els.debug.textContent += `\n\n----- COPIED -----\n${clipboardText}`;

    const c = merged?.confidence ?? 0;
    setStatus(`Done (${files.length} ảnh). Confidence: ${c}/100. Đã copy prescription.`);
  } catch (err) {
    console.error(err);
    setStatus("Lỗi. Xem debug.");
    els.debug.textContent = String(err?.message || err);
    alert("Scan lỗi rồi anh ơi. Mở console + xem debug để biết chi tiết.");
  } finally {
    setBusy(false);
  }
});

els.btnCopyClipboard.addEventListener("click", async () => {
  try {
    const text = (els.clipboardText.value || "").trim();
    if (!text) {
      alert("Chưa có text để copy. Anh scan trước nhé.");
      return;
    }
    await copyTextToClipboard(text);
    setStatus("Đã copy clipboard từ textbox.");
  } catch (err) {
    console.error(err);
    alert("Copy lỗi rồi anh ơi. Thử lại giúp em nhé.");
  }
});

// initial
clearAll();
setStatus("Chưa có ảnh.");
