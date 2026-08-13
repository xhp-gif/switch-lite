import type { ModelInfo, Preset, RecommendedSeries } from './types';

const SERIES_RULES: [RegExp, string][] = [
  [/deepseek/i, 'DeepSeek'],
  [/glm/i, 'GLM'],
  [/kimi|\bk2\b|\bk3\b/i, 'Kimi'],
  [/qwen/i, '通义千问'],
  [/minimax/i, 'MiniMax'],
  [/mimo/i, '小米'],
  [/claude/i, 'Claude'],
  [/gpt|\bo1\b|\bo3\b|\bo4\b|\bcodex/i, 'OpenAI'],
  [/gemini/i, 'Gemini'],
];

export function guessSeries(modelId: string): string | null {
  for (const [re, name] of SERIES_RULES) {
    if (re.test(modelId)) return name;
  }
  return null;
}

export function buildRecommendations(fetched: ModelInfo[], preset: Preset | null): RecommendedSeries[] {
  const available = new Set(fetched.map((m) => m.id));
  const series: RecommendedSeries[] = [];
  const seen = new Set<string>();

  if (preset?.recommended?.length) {
    for (const s of preset.recommended) {
      const items = s.models.map((id) => ({ id, available: available.has(id) }));
      if (items.length) {
        series.push({ series: s.series, note: s.note || '', items });
        items.forEach((i) => seen.add(i.id));
      }
    }
  }

  const auto = new Map<string, RecommendedSeries>();
  for (const m of fetched) {
    if (seen.has(m.id)) continue;
    const name = guessSeries(m.id);
    if (!name) continue;
    if (!auto.has(name)) auto.set(name, { series: name, note: '自动发现', items: [] });
    auto.get(name)!.items.push({ id: m.id, available: true });
  }
  for (const group of auto.values()) series.push(group);
  return series;
}
