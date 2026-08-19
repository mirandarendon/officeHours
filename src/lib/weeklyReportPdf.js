import { jsPDF } from "jspdf";

const PAGE_W = 612; // letter, pt
const PAGE_H = 792;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

const CARD_PAD = 14;
const CARD_GAP = 12;
const SESSION_ROW_H = 13;
const COL_GAP = 20;

const INK = [28, 43, 72];
const MUTED = [91, 107, 133];
const FAINT = [137, 150, 172];
const LINE = [223, 227, 234];
const GOOD = [47, 125, 82];
const GOOD_BG = [231, 242, 236];
const WARN = [179, 84, 30];
const WARN_BG = [250, 238, 229];
const NEUTRAL_BG = [238, 240, 243];

function pillSpec(status, metLabel, unmetLabel) {
  if (status === true) return { text: metLabel, fg: GOOD, bg: GOOD_BG };
  if (status === false) return { text: unmetLabel, fg: WARN, bg: WARN_BG };
  return { text: "N/A", fg: FAINT, bg: NEUTRAL_BG };
}

function drawPill(doc, rightX, y, spec) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const textW = doc.getTextWidth(spec.text);
  const padX = 7;
  const w = textW + padX * 2;
  const h = 14;
  const x = rightX - w;

  doc.setFillColor(...spec.bg);
  doc.roundedRect(x, y, w, h, 7, 7, "F");
  doc.setTextColor(...spec.fg);
  doc.text(spec.text, x + padX, y + h / 2 + 2.8);

  return w;
}

function sessionListHeight(count) {
  const rows = count === 0 ? 1 : Math.ceil(count / 2);
  return rows * SESSION_ROW_H;
}

function cardHeight(leader) {
  const headH = 34;
  const listH = sessionListHeight(leader.sessions.length);
  const totalRowH = 20;
  return CARD_PAD * 2 + headH + 6 + listH + 8 + totalRowH;
}

function drawPageHeader(doc, weekLabel, generatedAt) {
  let y = MARGIN;

  doc.setFont("times", "bold");
  doc.setFontSize(17);
  doc.setTextColor(...INK);
  doc.text("Weekly Office Hours Report", MARGIN, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...FAINT);
  doc.text(generatedAt, PAGE_W - MARGIN, y - 8, { align: "right" });
  doc.text("Student Government Office", PAGE_W - MARGIN, y, { align: "right" });

  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...MUTED);
  doc.text(`Week of ${weekLabel}`, MARGIN, y);

  y += 10;
  doc.setDrawColor(...INK);
  doc.setLineWidth(1.2);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);

  return y + 20;
}

function drawSessionColumns(doc, x, y, width, sessions) {
  if (sessions.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...FAINT);
    doc.text("No sessions logged this week.", x, y + 8);
    return;
  }

  const rows = Math.ceil(sessions.length / 2);
  const colW = (width - COL_GAP) / 2;

  sessions.forEach((s, i) => {
    const col = i < rows ? 0 : 1;
    const rowIdx = col === 0 ? i : i - rows;
    const cx = x + col * (colW + COL_GAP);
    const cy = y + rowIdx * SESSION_ROW_H + 8;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(s.day, cx, cy);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(s.time, cx + 32, cy);

    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.5);
    doc.line(cx, cy + 3.5, cx + colW, cy + 3.5);
  });
}

function drawLeaderCard(doc, y, leader) {
  const h = cardHeight(leader);
  const innerX = MARGIN + CARD_PAD;
  const innerW = CONTENT_W - CARD_PAD * 2;

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.75);
  doc.roundedRect(MARGIN, y, CONTENT_W, h, 4, 4, "S");

  const innerY = y + CARD_PAD;

  doc.setFont("times", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(leader.role, innerX, innerY + 9);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(leader.subtitle, innerX, innerY + 21);

  const hoursSpec = pillSpec(leader.hoursMet, "Hours met", "Hours short");
  const schedSpec = pillSpec(leader.onSchedule, "On schedule", "Off schedule");
  const rightEdge = MARGIN + CONTENT_W - CARD_PAD;
  const schedW = drawPill(doc, rightEdge, innerY - 4, schedSpec);
  drawPill(doc, rightEdge - schedW - 6, innerY - 4, hoursSpec);

  const listY = innerY + 34;
  drawSessionColumns(doc, innerX, listY, innerW, leader.sessions);

  const totalY = listY + sessionListHeight(leader.sessions.length) + 8;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
  doc.line(innerX, totalY, innerX + innerW, totalY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text("Total logged this week", innerX, totalY + 13);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...INK);
  doc.text(leader.totalLabel, innerX + innerW, totalY + 13, { align: "right" });

  return y + h;
}

/**
 * leaders: [{ role, subtitle, hoursMet: bool|null, onSchedule: bool|null,
 *             totalLabel: string, sessions: [{ day, time }] }]
 */
export function buildWeeklyReportPdf({ weekLabel, generatedAt, leaders, filename }) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  let y = drawPageHeader(doc, weekLabel, generatedAt);

  for (const leader of leaders) {
    const h = cardHeight(leader);
    if (y + h > PAGE_H - MARGIN - 24) {
      doc.addPage();
      y = drawPageHeader(doc, weekLabel, generatedAt);
    }
    y = drawLeaderCard(doc, y, leader) + CARD_GAP;
  }

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...FAINT);
    doc.text(filename, MARGIN, PAGE_H - MARGIN + 14);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - MARGIN + 14, {
      align: "right",
    });
  }

  return doc;
}
