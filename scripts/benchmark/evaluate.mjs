export function evaluateCase(item, text) {
  const value = String(text || "");
  const checks = (item.checks || []).map((rule) => {
    let pass = true;
    if (rule.any) pass &&= rule.any.some((word) => value.toLowerCase().includes(word.toLowerCase()));
    if (rule.none) pass &&= rule.none.every((word) => !value.toLowerCase().includes(word.toLowerCase()));
    if (rule.regex) pass &&= new RegExp(rule.regex, rule.flags || "u").test(value);
    return { id: rule.id, pass };
  });
  return { automaticChecksPassed: checks.every((check) => check.pass), checks,
    manualReviewRequired: true, reviewCriterion: item.review };
}
export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
}
