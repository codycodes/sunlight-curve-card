/**
 * Sunlight Curve Card for Home Assistant
 *
 * Shows day length across the whole year as a sine-like curve, marks today's
 * position on it, and tells you whether days are getting longer or shorter
 * and by how much per day.
 *
 * Everything is computed client-side from latitude (taken from your Home
 * Assistant home location by default), so the card needs no sensors,
 * integrations, or external data.
 */

const CARD_VERSION = "1.0.0";

const MS_PER_DAY = 86400000;

/** Solar declination in degrees for a given day of year. */
function declinationDeg(dayOfYear) {
  return -23.44 * Math.cos(((2 * Math.PI) / 365.24) * (dayOfYear + 10));
}

/**
 * Length of the day in hours (sunrise to sunset) for a latitude and day of
 * year, using the standard sunrise equation. Clamped for polar day/night.
 */
function dayLengthHours(latDeg, dayOfYear) {
  const rad = Math.PI / 180;
  const decl = declinationDeg(dayOfYear) * rad;
  let cosH = -Math.tan(latDeg * rad) * Math.tan(decl);
  cosH = Math.min(1, Math.max(-1, cosH));
  return (2 * Math.acos(cosH)) / rad / 15;
}

/** Day of year (1-based), DST-safe via UTC. */
function dayOfYear(date) {
  return Math.round(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(date.getFullYear(), 0, 0)) /
      MS_PER_DAY
  );
}

function daysInYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

function formatDuration(hoursFloat) {
  let h = Math.floor(hoursFloat);
  let m = Math.round((hoursFloat - h) * 60);
  if (m === 60) {
    h += 1;
    m = 0;
  }
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function formatDelta(seconds) {
  const s = Math.abs(Math.round(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  return `${m}m ${String(rem).padStart(2, "0")}s`;
}

class SunlightCurveCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("sunlight-curve-card-editor");
  }

  static getStubConfig() {
    return { title: "Daylight" };
  }

  setConfig(config) {
    this._config = {
      title: "Daylight",
      show_trend: true,
      show_extremes: true,
      ...config,
    };
    this._renderKey = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 4;
  }

  _locale() {
    return this._hass?.locale?.language || navigator.language || "en";
  }

  _render() {
    if (!this._config || !this._hass) return;

    const lat = Number(
      this._config.latitude ?? this._hass.config?.latitude ?? 0
    );
    const now = new Date();
    const key = `${lat}|${now.toDateString()}|${JSON.stringify(this._config)}`;
    if (key === this._renderKey) return;
    this._renderKey = key;

    const year = now.getFullYear();
    const nDays = daysInYear(year);
    const today = dayOfYear(now);

    // Day length for every day of the year.
    const lengths = [];
    for (let d = 1; d <= nDays; d++) lengths.push(dayLengthHours(lat, d));

    const todayLen = lengths[today - 1];
    const tomorrowLen = dayLengthHours(lat, today === nDays ? 1 : today + 1);
    const deltaSec = (tomorrowLen - todayLen) * 3600;
    const gaining = deltaSec >= 0;

    // Longest and shortest days of the year (works in both hemispheres).
    let maxDay = 1;
    let minDay = 1;
    lengths.forEach((len, i) => {
      if (len > lengths[maxDay - 1]) maxDay = i + 1;
      if (len < lengths[minDay - 1]) minDay = i + 1;
    });

    // The extreme we are heading toward: longest day if gaining, else shortest.
    const targetDay = gaining ? maxDay : minDay;
    let daysToTarget = targetDay - today;
    if (daysToTarget < 0) daysToTarget += nDays;
    const targetDate = new Date(year, 0, targetDay);
    const dateFmt = new Intl.DateTimeFormat(this._locale(), {
      month: "short",
      day: "numeric",
    });

    const svg = this._buildSvg(lengths, today, maxDay, minDay, nDays);

    const trendColor = gaining
      ? "var(--success-color, #4caf50)"
      : "var(--warning-color, #ff9800)";
    const trendArrow = gaining ? "▲" : "▼";
    const trendWord = gaining ? "longer" : "shorter";
    const targetWord = gaining ? "Longest day" : "Shortest day";

    const trendHtml = this._config.show_trend
      ? `<div class="trend" style="color:${trendColor}">
           ${trendArrow} Days are getting ${trendWord} by ${formatDelta(deltaSec)} per day
         </div>`
      : "";

    const targetHtml =
      daysToTarget === 0
        ? `<div class="target">${targetWord} of the year is today</div>`
        : `<div class="target">${targetWord}: ${dateFmt.format(targetDate)} (in ${daysToTarget} day${daysToTarget === 1 ? "" : "s"})</div>`;

    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 16px; }
        .title {
          font-size: 1.1em;
          font-weight: 500;
          color: var(--primary-text-color);
          margin-bottom: 4px;
        }
        .big {
          font-size: 1.7em;
          font-weight: 400;
          color: var(--primary-text-color);
          line-height: 1.2;
        }
        .big .sub {
          font-size: 0.55em;
          color: var(--secondary-text-color);
        }
        .trend { font-size: 0.95em; margin-top: 4px; font-weight: 500; }
        .target {
          font-size: 0.85em;
          color: var(--secondary-text-color);
          margin-top: 2px;
        }
        svg { width: 100%; height: auto; display: block; margin-top: 10px; }
      </style>
      <ha-card>
        ${this._config.title ? `<div class="title">${this._config.title}</div>` : ""}
        <div class="big">${formatDuration(todayLen)} <span class="sub">of daylight today</span></div>
        ${trendHtml}
        ${targetHtml}
        ${svg}
      </ha-card>
    `;
  }

  _buildSvg(lengths, today, maxDay, minDay, nDays) {
    const W = 480;
    const H = 210;
    const padL = 36;
    const padR = 12;
    const padT = 16;
    const padB = 24;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    let yMin = Math.min(...lengths);
    let yMax = Math.max(...lengths);
    // Near the equator the curve is almost flat; keep a sensible window.
    if (yMax - yMin < 1) {
      const mid = (yMax + yMin) / 2;
      yMin = mid - 1;
      yMax = mid + 1;
    } else {
      const pad = (yMax - yMin) * 0.12;
      yMin = Math.max(0, yMin - pad);
      yMax = Math.min(24, yMax + pad);
    }

    const x = (day) => padL + ((day - 1) / (nDays - 1)) * plotW;
    const y = (len) => padT + (1 - (len - yMin) / (yMax - yMin)) * plotH;
    const r2 = (v) => Math.round(v * 100) / 100;

    // Curve path and area fill.
    let path = "";
    let area = `M ${r2(x(1))} ${r2(padT + plotH)} `;
    for (let d = 1; d <= nDays; d++) {
      const px = r2(x(d));
      const py = r2(y(lengths[d - 1]));
      path += (d === 1 ? "M" : "L") + ` ${px} ${py} `;
      area += `L ${px} ${py} `;
    }
    area += `L ${r2(x(nDays))} ${r2(padT + plotH)} Z`;

    // Horizontal gridlines at a nice hour step (aim for 3–5 lines).
    const span = yMax - yMin;
    const step = [1, 2, 3, 4, 6].find((s) => span / s <= 5) || 6;
    let grid = "";
    for (let h = Math.ceil(yMin); h <= Math.floor(yMax); h++) {
      if (h % step !== 0) continue;
      const gy = r2(y(h));
      grid += `
        <line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}"
              stroke="var(--divider-color, #e0e0e0)" stroke-width="1"/>
        <text x="${padL - 6}" y="${gy + 3}" text-anchor="end" class="lbl">${h}h</text>`;
    }

    // Month labels along the x axis.
    const year = new Date().getFullYear();
    const monthFmt = new Intl.DateTimeFormat(this._locale(), { month: "narrow" });
    let months = "";
    for (let m = 0; m < 12; m++) {
      const first = new Date(year, m, 1);
      const mid = new Date(year, m, 15);
      months += `
        <line x1="${r2(x(dayOfYear(first)))}" y1="${padT + plotH}"
              x2="${r2(x(dayOfYear(first)))}" y2="${padT + plotH + 4}"
              stroke="var(--divider-color, #e0e0e0)" stroke-width="1"/>
        <text x="${r2(x(dayOfYear(mid)))}" y="${H - 8}" text-anchor="middle" class="lbl">
          ${monthFmt.format(mid)}
        </text>`;
    }

    // Solstice markers (longest and shortest day).
    let extremes = "";
    if (this._config.show_extremes) {
      for (const [d, above] of [[maxDay, true], [minDay, false]]) {
        const len = lengths[d - 1];
        const ex = r2(x(d));
        const ey = r2(y(len));
        const ty = above ? ey - 8 : ey + 15;
        extremes += `
          <circle cx="${ex}" cy="${ey}" r="3"
                  fill="var(--card-background-color, #fff)"
                  stroke="var(--secondary-text-color, #757575)" stroke-width="1.5"/>
          <text x="${ex}" y="${ty}" text-anchor="middle" class="lbl">${formatDuration(len)}</text>`;
      }
    }

    // Today marker: vertical dashed line plus a dot on the curve.
    const tx = r2(x(today));
    const ty = r2(y(lengths[today - 1]));
    const lineColor = this._config.line_color || "var(--primary-color, #03a9f4)";
    const todayMark = `
      <line x1="${tx}" y1="${ty}" x2="${tx}" y2="${padT + plotH}"
            stroke="${lineColor}" stroke-width="1" stroke-dasharray="3,3" opacity="0.7"/>
      <circle cx="${tx}" cy="${ty}" r="5" fill="${lineColor}"
              stroke="var(--card-background-color, #fff)" stroke-width="2"/>`;

    return `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"
           role="img" aria-label="Day length across the year">
        <style>
          .lbl {
            font: 10px sans-serif;
            fill: var(--secondary-text-color, #757575);
          }
        </style>
        ${grid}
        <path d="${area}" fill="${lineColor}" opacity="0.12"/>
        <path d="${path}" fill="none" stroke="${lineColor}" stroke-width="2.5"
              stroke-linejoin="round"/>
        ${months}
        ${extremes}
        ${todayMark}
      </svg>`;
  }
}

class SunlightCurveCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (schema) =>
        ({
          title: "Title",
          latitude: "Latitude override (defaults to home location)",
          show_trend: "Show longer/shorter trend",
          show_extremes: "Show longest/shortest day markers",
        })[schema.name] ?? schema.name;
      this._form.addEventListener("value-changed", (ev) => {
        this._config = ev.detail.value;
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: this._config },
            bubbles: true,
            composed: true,
          })
        );
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = this._config;
    this._form.schema = [
      { name: "title", selector: { text: {} } },
      {
        name: "latitude",
        selector: { number: { min: -90, max: 90, step: 0.01, mode: "box" } },
      },
      { name: "show_trend", selector: { boolean: {} } },
      { name: "show_extremes", selector: { boolean: {} } },
    ];
  }
}

customElements.define("sunlight-curve-card", SunlightCurveCard);
customElements.define("sunlight-curve-card-editor", SunlightCurveCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sunlight-curve-card",
  name: "Sunlight Curve Card",
  description:
    "Day length across the year on a sine curve, with today's position and whether days are getting longer or shorter.",
  preview: true,
});

console.info(
  `%c SUNLIGHT-CURVE-CARD %c v${CARD_VERSION} `,
  "background:#ff9800;color:#000;font-weight:bold",
  "background:#444;color:#fff"
);
