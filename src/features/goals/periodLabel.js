export function periodLabel(sub) {
  if (sub.type === "month") return `${sub.year}년 ${sub.month}월`;
  return `${sub.year}년 ${sub.month}월 ${sub.weekOfMonth}주`;
}
