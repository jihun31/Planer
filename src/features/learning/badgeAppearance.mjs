import { STREAK_DAY_BADGES, WEEKLY_HOUR_BADGES } from './learningStats.mjs';

const tiers = ['bronze','silver','gold','navy','champagne','rose','platinum','legend'];
export const tierLabel = Object.freeze({
  bronze:'시작', silver:'성장', gold:'도약', navy:'집중',
  champagne:'몰입', rose:'숙련', platinum:'정점', legend:'전설',
});

export function badgeTier(type, target) {
  const milestones = type === 'week' ? WEEKLY_HOUR_BADGES : STREAK_DAY_BADGES;
  const value = type === 'week' ? target/60 : target;
  return tiers[Math.max(0,milestones.findLastIndex(milestone => value >= milestone))];
}
