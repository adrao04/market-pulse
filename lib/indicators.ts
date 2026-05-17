export function calcRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const deltas = closes.slice(1).map((v, i) => v - closes[i]);
  const recent = deltas.slice(-period);
  const gains = recent.map(d => (d > 0 ? d : 0));
  const losses = recent.map(d => (d < 0 ? -d : 0));
  const avgG = gains.reduce((a, b) => a + b, 0) / period;
  const avgL = losses.reduce((a, b) => a + b, 0) / period;
  if (avgL === 0) return 100;
  return Math.round((100 - 100 / (1 + avgG / avgL)) * 100) / 100;
}

export function calcSma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const window = values.slice(-period);
  return Math.round((window.reduce((a, b) => a + b, 0) / period) * 100) / 100;
}

export function calcEma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const v of values.slice(period)) {
    ema = v * k + ema * (1 - k);
  }
  return ema;
}

export function calcMacd(
  closes: number[]
): [number | null, number | null, number | null, number | null] {
  if (closes.length < 35) return [null, null, null, null];

  const macdSeries: number[] = [];
  for (let i = 26; i <= closes.length; i++) {
    const e12 = calcEma(closes.slice(0, i), 12);
    const e26 = calcEma(closes.slice(0, i), 26);
    if (e12 != null && e26 != null) macdSeries.push(e12 - e26);
  }
  if (macdSeries.length < 9) return [null, null, null, null];

  const macdNow = macdSeries[macdSeries.length - 1];
  const signalNow = calcEma(macdSeries, 9);
  const histogram = signalNow != null ? macdNow - signalNow : null;

  let histPrev: number | null = null;
  if (macdSeries.length >= 10) {
    const signalPrev = calcEma(macdSeries.slice(0, -1), 9);
    histPrev =
      signalPrev != null
        ? macdSeries[macdSeries.length - 2] - signalPrev
        : null;
  }

  const r = (n: number | null) =>
    n != null ? Math.round(n * 10000) / 10000 : null;
  return [r(macdNow), r(signalNow), r(histogram), r(histPrev)];
}

export function calcBollinger(
  closes: number[],
  period = 20,
  mult = 2
): [number | null, number | null, number | null] {
  if (closes.length < period) return [null, null, null];
  const window = closes.slice(-period);
  const mean = window.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(
    window.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / period
  );
  const r = (n: number) => Math.round(n * 100) / 100;
  return [r(mean), r(mean + mult * std), r(mean - mult * std)];
}
